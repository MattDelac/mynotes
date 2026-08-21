# MyNotes — Spec & Plan

## Concept

Excalidraw-simplicity note-taking: open the app, get a blank page, start typing.
Local-first, end-to-end encrypted, fully open source. Share via encrypted link.

## Core Principles

- **Local-first**: notes live in IndexedDB; the server is only involved when sharing
- **Zero-knowledge server**: AES-GCM key generated client-side, travels only in the
  URL fragment (`#key`), never sent to the backend
- **One blank page**: no folders, no dashboards — a list of local notes + one editor
- **Privacy is a feature**: no accounts, no tracking, plaintext never leaves the
  device except on explicit user action (export / share)

## Architecture

### Frontend (TypeScript + Svelte)

- Editor: CodeMirror 6 with live markdown highlighting and Typora-style mark
  concealment (formatting marks hidden except on the cursor line), plus optional
  rendered preview toggle
- Local persistence: IndexedDB via `idb` + y-indexeddb (Yjs documents), autosave
- Crypto: Web Crypto API, AES-GCM-256. Key gen → encrypt → export key to URL
  fragment
- PWA manifest for "add to home screen" on mobile

### Session model

A **session** is a single Yjs document (`Y.Map<Y.Text>`) holding all of the
user's notes. Sessions are the unit of persistence, routing, and sharing:

- Routes: `/s/{sessionId}` (current note in `?n={noteId}` query param)
- Notes within a session are listed in the sidebar; "Start empty session" creates
  a fresh, unrelated session
- Sharing operates on the whole session (all notes at once)
- Legacy per-note shares (`/n/{id}`) are frozen: old links keep working, new
  shares are always session-level

### Backend (Rust, Axum + SQLite)

Zero-knowledge encrypted blob store. No auth, no accounts.

| Endpoint         | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `POST /notes`    | Store encrypted blob `{ id, ciphertext, created_at, updated_at }`  |
| `GET /notes/:id` | Fetch blob                                                         |
| `PUT /notes/:id` | Owner re-push, protected by an edit token (also in URL fragment)   |
| `PUT /blobs/:id` | Store opaque encrypted image blob (write-once, idempotent)         |
| `GET /blobs/:id` | Fetch image blob (ciphertext)                                      |

Optional blob TTL (e.g., auto-delete after 30 days).

## Sharing Flow (CRDT collaboration)

1. User hits "Share" → client generates AES key + edit token, creates a room
2. An encrypted snapshot of the session's Yjs document seeds the server's update log
3. Links (both exposed in the share panel):
   - View: `https://app/s/{id}#{key}` (read-only)
   - Owner/editor: `https://app/s/{id}#{key}:{edit_token}` (can edit)
4. All participants sync live over an encrypted WebSocket relay: every Yjs update
   is encrypted client-side before broadcast — the server never sees plaintext
5. Edits converge via CRDT; no conflicts, no last-write-wins data loss
6. The update log is compacted with an encrypted snapshot when it grows large

## Features

### Export to disk

- "Export" button → serialize the current note as markdown → browser download
  as `{title-or-id}.md`
- **Unencrypted plaintext** — confirmation dialog: "This will export an
  unencrypted copy"
- On mobile, uses the standard share/download flow (lands in Files)
- No server involvement; works fully offline

### Images

- Notes can embed images as `![alt](mynotes:<id>)` references; the bytes are
  encrypted with the session key and stored as opaque blobs — the server stays
  zero-knowledge (full design: `docs/IMAGES.md`)
- Rollout is phased: the server blob API has shipped; client insertion
  (paste/drag-drop), local rendering, and sharing follow in the UX backlog

### Send via email

- Flow: "Share via email" → client generates the E2EE share link (pushing the
  encrypted blob if not already shared) → opens `mailto:` with prefilled subject
  (note title) and body containing the link
- No attachments (`mailto:` can't attach files), no URL-length issues — link
  is short
- Confirmation dialog: "Anyone with this link can read the note. The key is in
  the link — treat the email as sensitive."
- Abuse posture: nothing is sent from our server; it's the user's own mail
  client. No relay to protect, no rate limits needed.

### Removed: AI chat

A BYOK AI sidecar chat was built in M4 and later removed — the project stays
focused on notes + collaboration.

### Removed: Voice input

Voice dictation (Web Speech API plus optional on-device Whisper via
transformers.js) shipped in M5 and was later removed — the project stays
focused on notes + collaboration.

## Roadmap

| Milestone | Scope                                                              |
| --------- | ------------------------------------------------------------------ |
| **M1**    | Skeleton: repo setup, Axum hello-world, Svelte frontend, CI (fmt/clippy) |
| **M2**    | Local notes: markdown editor + IndexedDB autosave, note list       |
| **M3**    | Share: crypto module, blob API, share/view links, mailto-with-link flow |
| **M4**    | AI chat: BYOK panel (later removed)                                 |
| **M5**    | Voice + Export: Web Speech API dictation (later removed), plaintext export-to-disk |
| **M6**    | Polish: PWA, mobile UX, self-host docs, MIT license                |

## Explicitly Out of Scope (v1)

- Presence/awareness (collaborator cursors, names)
- Accounts
- Rich text, drawing (images are in scope as encrypted blob references)
- Server-side AI proxying

## Open Decisions

- Svelte vs React (Svelte preferred for minimalism)
- SQLite vs Postgres (SQLite preferred for self-hosting simplicity)
