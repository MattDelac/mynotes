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

### Writing experience (invisible ergonomics)

Formatting lives in the keyboard and typing behavior, never in added chrome — all
documents stay pure markdown. Planned (see `docs/UX-BACKLOG.md` for scope and
browser-reservation audit of every chord):

- Formatting toggles with selection-or-word semantics: bold (Mod+B), italic
  (Mod+I), strikethrough (Mod+Alt+X), inline code (Mod+Alt+C)
- Heading levels: Mod+Alt+1..6 set the current line's ATX level, Mod+Alt+0 removes it
- Link command: Mod+K (clipboard URL auto-fill; pasting a URL over a selection
  already links it via the built-in `pasteURLAsLink`)
- Task lists: `- [ ]` lines continue on Enter — ordered tasks (`1. [ ] x`)
  continue the `[ ]` marker too (an empty ordered task exits the list on Enter
  or Backspace, like bullets); the bracket token toggles on click in the editor
  and in the preview
   (preview disabled in read-only shares); Mod+Alt+L toggles the current line
   between a task and its plain form in every GFM task form — top-level
   (`- x` ↔ `- [ ] x`, any other free line → `- [ ] line`), ordered
   (`1. x` ↔ `1. [ ] x`, incl. `1)` and nested/quoted) and blockquoted bullet
   (`> - x` ↔ `> - [ ] x`) — a content-less marker line (`- [ ]`, `1. [ ]`,
   `> - [ ]`) strips to its plain item — while a plain quoted line stays a
   no-op (as in code, tables, setext pairs, and thematic breaks)
- Restored work position: each note's caret/selection survives note switches
  and page reloads (restored scroll included); per-note undo history survives
  switches

### Export to disk

- "Export" button → serialize the current note as markdown → browser download
  as `{title-or-id}.md`
- **Unencrypted plaintext** — confirmation dialog: "This will export an
  unencrypted copy"
- On mobile, uses the standard share/download flow (lands in Files)
- No server involvement; works fully offline

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
- Rich text, images, drawing
- Server-side AI proxying

## Open Decisions

- Svelte vs React (Svelte preferred for minimalism)
- SQLite vs Postgres (SQLite preferred for self-hosting simplicity)
