# Images in MyNotes — Design

Status: **design only** (no code yet). This is the committed design doc that unblocks
implementation. It is written against the hard rules in `AGENTS.md` and the session model
in `docs/PLAN.md`. Implementation is broken into phased, independently shippable slices at
the end.

## 1. Goal

Let a note contain images, without adding visible complexity, without breaking
zero-knowledge, and without changing the markdown storage format. The writing experience
stays effortless (paste/drop an image → it appears), and the reading experience (preview)
shows the image inline.

Non-goals (v1): external/remote image URLs, a live `<img>` inside the CodeMirror editor,
image management UI, per-image encryption keys, OCR/captions.

## 2. How this design honors the hard rules

- **Zero-knowledge**: image bytes are encrypted client-side with the *existing per-session
  AES-GCM key* and uploaded as opaque ciphertext. The server stores ciphertext + a random
  id and never decrypts, inspects, or links them. The key stays in the URL fragment / local
  storage, exactly like today.
- **Markdown stays the format**: a note's content is still a `Y.Text` of markdown. An image
  is the reference `![alt](mynotes:<blobId>)` — a URI *inside* a standard markdown image
  link. The bytes live separately (local IndexedDB, and on the server as an opaque blob) and
  are resolved **client-side**. No HTML/rich-text document, no new document model.
- **No new dependencies**: Web Crypto, `createImageBitmap`/`<canvas>`, IndexedDB (already in
  use via `idb`), and the existing Rust/axum/sqlx stack. Nothing new in `package.json` or
  `Cargo.toml`.
- **Invisible ergonomics**: insertion is paste / drag-drop (no toolbar, no menu item). The
  editor shows a compact "image chip" token; the preview shows the image. No visible UI is
  added to write a note.

## 3. Key decisions (and why)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Blob id | **Client-chosen UUID**, embedded in the markdown | The same `mynotes:<id>` resolves locally *and* on the server, so sharing needs **no markdown rewrite**. Server-assigned ids (today's `POST /notes`) would force a rewrite pass at share time. |
| Keying | **Per-session key** (reuse the session AES-GCM key) | No key-management/distribution needed; recipients already hold the key in the link. Per-image keys would have nowhere to live (the doc is already encrypted with the session key, so embedding per-image keys gains nothing). |
| Blob semantics | **Write-once, idempotent, no edit token** | A random id means the first writer (the owner, who has the plaintext) wins. A recipient who sees the id in a shared doc cannot overwrite (the row already exists → `204`) and cannot delete (no delete endpoint). Simpler and safer than the notes token model for immutable content. |
| Local bytes | **Plaintext in IndexedDB** | Matches note content (also plaintext locally). Encryption only protects what leaves the device. The device is the trust boundary. |
| Editor render | **Chip token, not a live `<img>`** (v1) | Keeps CodeMirror fast and avoids CM-widget/CRDT line-wrapping complexity. Matches the existing "editor = typing, preview = reading" split. Inline `<img>` is a later enhancement. |
| Insertion | **Paste + drag-drop** | Covers the common cases with zero UI. No toolbar, honoring "prefer invisible ergonomics." |

## 4. Data model

### 4.1 Markdown reference

```
![alt text](mynotes:<blobId>)
```

- `blobId` is a `crypto.randomUUID()` value, stable across local and shared contexts.
- `alt` is meaningful text (empty `![](...)` = decorative).
- `mynotes:` is a **client-resolved scheme**. Only `mynotes:` refs are resolved/rendered in
  v1; any other image URL (e.g. `https://…`) is out of scope and renders as literal
  markdown (no tracking, no remote fetch).

### 4.2 Local storage (new IndexedDB store, `db.ts` → schema v3)

```ts
interface BlobRecord {
	id: string;        // UUID; identical to the mynotes: ref
	data: ArrayBuffer; // raw (possibly downscaled) image bytes, PLAINTEXT locally
	type: string;      // mime, e.g. "image/webp"
	width: number;     // decoded pixel dimensions (for aspect ratio before load)
	height: number;
	createdAt: number;
}
// store: db.createObjectStore('blobs', { keyPath: 'id' })
```

### 4.3 Server storage (new table, additive)

See migration below. One row per image; `id` is the client UUID.

## 5. Cryptography

Reuse `apps/web/src/lib/crypto.ts` unchanged. The wire framing is already
`IV(12) || AES-GCM ciphertext+tag` (`encryptBytes`). For a blob:

```ts
const cipher = await encryptBytes(sessionKey, imageBytes); // sessionKey: CryptoKey
// upload `cipher` as the opaque body; the id is the client UUID, not in the body
```

The server treats `cipher` as opaque bytes. Decryption on read uses the same
`decryptBytes(sessionKey, cipher)`.

## 6. API (concrete)

### 6.1 Migration `api/migrations/0004_blobs.sql`

```sql
-- Opaque encrypted image blobs. The server never decrypts or inspects these.
-- id is a client-chosen UUID embedded in note markdown (e.g. `![alt](mynotes:<id>)`),
-- so the same reference resolves locally and on the server with no rewrite on share.
CREATE TABLE IF NOT EXISTS blobs (
    id            TEXT PRIMARY KEY,
    ciphertext    BLOB NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_activity TEXT
);

CREATE INDEX IF NOT EXISTS idx_blobs_last_activity ON blobs (last_activity);
```

### 6.2 Endpoints (additive; existing routes untouched)

`PUT /blobs/{id}` — store an opaque encrypted image blob (write-once, idempotent).

- Request: raw body = ciphertext bytes (`IV(12) || AES-GCM ciphertext+tag`).
- Limits: body non-empty; `len <= MAX_IMAGE_SIZE` else `413 Payload Too Large`.
- Rate limit: the existing `create` bucket (`RATE_CREATE_PER_MIN`).
- Behavior: `INSERT INTO blobs (id, ciphertext, last_activity) VALUES (?, ?, now)
  ON CONFLICT(id) DO NOTHING`.
  - `rows_affected > 0` → `201 Created`, body `{"id": "<id>"}`.
  - `rows_affected == 0` (already present — immutable) → `204 No Content`.
- No `x-edit-token` (write-once). A re-`PUT` with the same id is a no-op that returns `204`;
  the first writer's bytes are kept.

`GET /blobs/{id}` — fetch an opaque encrypted image blob.

- Rate limit: the existing `read` bucket (`RATE_READ_PER_MIN`).
- Behavior: `SELECT ciphertext FROM blobs WHERE id = ?`.
  - found → `200 OK`, body = ciphertext bytes; throttled touch of `last_activity`
    (reuse the `touch_activity` / `ACTIVITY_TOUCH_INTERVAL` pattern from notes).
  - not found → `404 {"error":"blob not found"}`.

### 6.3 Config additions (`api/src/config.rs`)

- `max_image_size: usize` — env `MAX_IMAGE_SIZE`, **default `5 * 1024 * 1024` (5 MB)**.
  (Encrypted framing adds a 12-byte IV + 16-byte tag; negligible.)
- Rate limits: **reuse** `rate_create_per_min` (PUT) and `rate_read_per_min` (GET). Add
  dedicated `RATE_IMAGE_*` knobs only if image traffic ever needs its own budget.
- TTL: **reuse** `ttl_days` + `cleanup_interval_secs`. Blobs are swept by
  `COALESCE(last_activity, created_at)`.

### 6.4 Body-limit gotcha (must fix)

The router currently applies `.layer(DefaultBodyLimit::max(config.max_snapshot_size))`
(2 MB). With `MAX_IMAGE_SIZE = 5 MB`, a 4 MB image body would be rejected by the *layer*
before the handler runs. Change the layer to
`DefaultBodyLimit::max(config.max_snapshot_size.max(config.max_image_size))`.

### 6.5 TTL cleanup (extend `cleanup_expired` in `lib.rs`)

Add a third sweep alongside notes + room_updates:

```sql
DELETE FROM blobs WHERE COALESCE(last_activity, created_at) <
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)   -- ? = "-<ttl_days> days"
```

Access-driven: an image that is being viewed keeps `last_activity` fresh (touched on GET),
so in-use images survive while orphans (referenced by a dead room, never fetched) are GC'd.
The returned count is logged with the existing cleanup log line.

## 7. Client flows

### 7.1 Insert (paste / drag-drop) — invisible ergonomics

1. Capture bytes: `paste` event (`image/*` in `clipboardData`) or a dropped `File`.
2. Downscale (dependency-free, built-in): `createImageBitmap(file)` → draw to `<canvas>`
   capped at **long edge 2048 px** → `canvas.toBlob("image/webp", 0.8)`. Keep the original
   bytes if the source is already small (≤ 512 KB and ≤ 2048 px) to avoid needless
   re-encoding; fall back to the original type if WebP isn't supported.
3. `blobId = crypto.randomUUID()`.
4. Store locally: `putBlob(blobId, { data, type, width, height })` (IndexedDB, plaintext).
5. Insert `![<alt>](mynotes:<blobId>)` at the caret as a `Y.Text` transaction. Default
   `alt` = file name without extension (or empty if decorative).
6. If the session is **currently shared** (`share` is set, or viewing an owned shared
   session): immediately `uploadBlob(blobId)` (§7.4) so other participants can see it.
   For a local-only session, **nothing** is sent to the server (privacy + bandwidth).
7. If the (downscaled) bytes would exceed `MAX_IMAGE_SIZE`, toast "Image too large" and do
   not insert.

### 7.2 Rendering

Preview (reading view):

1. `marked` renders `![alt](mynotes:<id>)` → `<img alt="alt" src="mynotes:<id>">`.
2. Configure DOMPurify (in `markdown.ts`) so the `mynotes:` src survives sanitization —
   extend the allowed-src rule to include the inert `mynotes:` scheme (it is not a
   fetchable network scheme; our resolver intercepts it). Lock this with a unit test:
   `renderMarkdown("![a](mynotes:x)")` must yield an `<img>` whose `src` still reads
   `mynotes:x` (not stripped).
3. Async component pass over the rendered note: for each `<img src^="mynotes:">`, resolve
   bytes → data URL and set `img.src` (add `loading="lazy"`):
   1. Local: `getBlob(id)` from IndexedDB.
   2. Else if shared (session key available): `fetch /blobs/{id}` →
      `decryptBytes(sessionKey, bytes)`.
   3. Build `data:<type>;base64,<b64>`; cache in a module-level `Map<id, dataUrl>`.
4. On resolution failure (missing locally + `404` remotely, or decrypt error): swap to a
   placeholder chip ("Image unavailable") with an optional retry. Never block the rest of
   the note; drop-and-ignore like existing undecryptable WS updates.

Editor (writing view, v1):

- Do **not** render a live `<img>` in CodeMirror. Decorate the `mynotes:` reference with a
  compact inline "image chip": a small glyph + the alt text (or a short id). Implement as a
  `StateField`/`ViewPlugin` `Decoration.replace`/widget over the ref range (regex over the
  line `!\[[^\]]*\]\(mynotes:[0-9a-fA-F-]+\)`, or a lezer `InlineImage` node match — confirm
  the exact node name against the installed `@lezer/markdown`, the same way the
  strikethrough grammar was verified). `Decoration.replace` hides the text from the viewport
  while keeping it in the model — the same mechanism `cm-conceal.ts` already uses — so it is
  safe with the CRDT.
- Clicking the chip is a no-op in v1 (no image manager).

### 7.3 Rendering data sources, by role

- **Owner, local-only session**: bytes from local IndexedDB. No server round-trip.
- **Owner, shared session**: local IndexedDB first (fast path); upload on insert.
- **Read-only viewer** (opened the share link): local IndexedDB if present, else
  `GET /blobs/{id}` + `decryptBytes(key, bytes)`. Can view, cannot insert, no upload path.

### 7.4 Upload (owner / writable participant)

```ts
async function uploadBlob(id: string, data: Uint8Array, key: CryptoKey): Promise<void> {
	const cipher = await encryptBytes(key, data);
	// PUT <api>/blobs/<id>  (body = cipher) → expect 201 or 204 (idempotent)
}
```

Called (a) at **share time** for every distinct `mynotes:<id>` in the session's notes, and
(b) **on insert** when the session is already shared. Idempotency means re-running is safe.

## 8. Sharing flow (the zero-knowledge crux)

In `shareSession()` (`s/[id]/+page.svelte`), after the existing Yjs snapshot push:

1. Collect distinct `mynotes:<id>` refs across all notes in the session (`doc.notes`).
2. For each: `data = (await getLocalBlob(id)).data`; `await uploadBlob(id, data, sessionKey)`.
3. Continue creating the view/owner links as today.

Because the markdown already contains `mynotes:<id>` and the server blob id is that same
`<id>`, **no markdown rewrite happens**. A recipient resolves `mynotes:<id>` →
`GET /blobs/{id}` → `decryptBytes(linkKey, bytes)`.

**What happens when a session is shared:** every image referenced by the session is uploaded
(encrypted with the session key) at share time; any image added afterward by a writable
participant is uploaded on insert. Anyone holding the link (i.e. the key in the fragment)
can fetch and decrypt the images — the same access model as the notes. The server only ever
stores ciphertext. Unsharing/deleting a room leaves the blobs to their own access-TTL
(not purged immediately in v1).

## 9. Sizing & performance

- **Downscale targets**: long edge ≤ 2048 px, WebP q ≈ 0.8 → typical blobs ~100 KB–1.5 MB.
- **`MAX_IMAGE_SIZE`**: 5 MB default (headroom for fine-detail screenshots that resist
  compression).
- **Data URLs** in the preview inflate ~33% in memory (a 5 MB image ≈ 6.7 MB data URL).
  Acceptable for v1; use `loading="lazy"`. If a note carries many large images, switch the
  preview to `URL.createObjectURL` with revoke-on-rerender (future).
- **Caching**: a module-level `Map<id, dataUrl>` avoids re-resolving across re-renders;
  viewers may additionally cache decrypted bytes in IndexedDB (optional, later).

## 10. Security / privacy review

- Server stores only AES-GCM-256 ciphertext, keyed by the session key. The key is
  client-generated and lives only in the URL fragment + local storage — never transmitted.
- Blob ids are random UUIDs (unguessable). A server or network observer sees opaque
  ciphertext + random ids; it cannot read, link, or modify them. Modification is impossible
  (write-once, idempotent-by-id, no delete).
- Access = possession of the link (the key), identical to the existing note-sharing trust
  model. No new trust surface, no tracking (only `mynotes:` refs are resolved; no remote
  image fetches).
- The `mynotes:` scheme is resolved strictly client-side; the server never fetches or
  interprets it.

## 11. Failure modes & UX

- Missing locally + `404` on server (GC'd, or shared from a device that never uploaded it):
  placeholder chip "Image unavailable" + retry; the rest of the note still renders. In the
  editor the ref still shows as a chip.
- Decrypt failure (wrong key / corrupt bytes): same placeholder; ignore like undecryptable
  WS updates.
- Oversize after downscale: toast + skip insert.
- No WebP support in a viewer: `canvas.toBlob` falls back to PNG; the data-URL mime matches
  the actual bytes.

## 12. Testing plan

Unit (vitest):

- `crypto.ts`: round-trip `encryptBytes` → `decryptBytes` on image-like bytes (pins the
  framing reused for blobs).
- New `lib/images.ts` pure helpers: `parseMynotesRefs(markdown) -> string[]` (multiple,
  none, de-dupe, ignores non-`mynotes:` image URLs, ignores `mynotes:` outside image links)
  and downscale parameter selection (cap/mime), stubbing the canvas where needed.
- `markdown.ts`: assert `renderMarkdown("![a](mynotes:x)")` retains a resolvable
  `src="mynotes:x"` (DOMPurify config locked).

e2e (playwright):

- **Local-only**: paste/drop an image into a note → markdown contains
  `![…](mynotes:<uuid>)` → preview shows a real `<img>` with a `data:` src and expected
  dimensions.
- **Share**: share a session containing an image → a second view-only context opens the
  view link → the image renders (proves the fetch + decrypt path).
- **Zero-knowledge assertion**: after share, `GET /blobs/{id}` raw bytes are **not** the
  plaintext (differ from the uploaded bytes, no image magic bytes at offset 0); decrypting
  with the *session key* yields the original, a random key fails.
- **Write-once**: a second `PUT /blobs/{id}` with different bytes returns `204` and a
  subsequent `GET` still returns the original ciphertext.

Rust (cargo test, in-memory SQLite):

- `PUT /blobs/{id}` → `201`; idempotent re-`PUT` → `204`; oversize body → `413`;
  `GET` known → `200`, unknown → `404`.
- TTL sweep removes stale blobs and spares recently-accessed ones.
- Body-limit layer admits up to `max_snapshot_size.max(max_image_size)`.

## 13. Migration / rollout plan

Each phase ships green and independently; nothing here changes existing data or routes.

- **Phase 0 — this doc.** No code.
- **Phase 1 — API (backend only, additive, backward-compatible).**
  - `api/migrations/0004_blobs.sql`.
  - `config.rs`: `max_image_size` (+ `MAX_IMAGE_SIZE` env); raise `DefaultBodyLimit` to
    `max(max_snapshot_size, max_image_size)`.
  - `lib.rs`: `PUT /blobs/{id}`, `GET /blobs/{id}`, throttled `last_activity` touch on
    GET, extend `cleanup_expired` for blobs.
  - Cargo tests (§12). No frontend change.
- **Phase 2 — client, local-only.**
  - `db.ts`: `blobs` store (schema v3) + `putBlob`/`getBlob`/`deleteBlob`.
  - `lib/images.ts` (new): downscale, `parseMynotesRefs`, resolve-to-data-URL (local).
  - Editor: `mynotes:` chip decoration. Preview: DOMPurify `mynotes:` allow + async data-URL
    pass + placeholder. Insertion: paste + drag-drop handlers.
  - Unit + e2e (local). Screenshots: add an image to a fixture and regenerate with
    `pnpm screenshots` (docker) — or reason about fixture impact if docker is unavailable.
- **Phase 3 — sharing (the zero-knowledge path).**
  - `api.ts`/`share.ts`: `uploadBlob`/`fetchBlob`.
  - `shareSession()`: upload referenced blobs at share time; insert-into-shared-session
    uploads on insert. Viewer: fetch + decrypt + render.
  - e2e (share + zero-knowledge + write-once assertions).
- **Phase 4 — polish.**
  - Lazy local GC of unreferenced blobs; placeholder/retry UX; mobile feel; screenshots
    fixture + regenerate.

Backward compatibility: images are opt-in (they only exist once inserted); `mynotes:` refs
are inert in old notes; the `blobs` table and routes are additive; old clients ignore
unknown `mynotes:` refs (rendered as literal markdown / a placeholder). Rollback: dropping
the feature leaves `mynotes:` refs as inert text and the server `blobs` table as harmless
additive state swept by TTL.

## 14. Out of scope (v1) / future

- External/remote image URLs (privacy/tracking) — only `mynotes:` refs.
- Live inline `<img>` in the CodeMirror editor — chip only for v1.
- Image management UI (replace/delete/reorder) — no toolbar.
- Per-image keys, image edit tokens, explicit `DELETE /blobs/{id}`.
- Thumbnails / blurhashes for lazy-load placeholders (a small canvas thumb could fill the
  placeholder slot).
- OCR / captions.

## 15. Open questions (for a human)

- `MAX_IMAGE_SIZE` default (5 MB) — confirm.
- Downscale targets (2048 px / WebP 0.8) — confirm, and whether lossless PNG should be kept
  for screenshot-like images.
- Editor: chip-only (v1) vs. inline image — confirm the chip is acceptable for the writing
  experience.
- Blob TTL tied to per-blob access (vs. the referencing room's lifetime) — confirm
  acceptable.
