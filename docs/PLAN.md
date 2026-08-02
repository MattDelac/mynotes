# MyNotes — Spec & Plan

## Concept

Excalidraw-simplicity note-taking: open the app, get a blank page, start typing.
Local-first, end-to-end encrypted, fully open source. Share via encrypted link.
Optional AI sidecar chat with bring-your-own-key (BYOK).

## Core Principles

- **Local-first**: notes live in IndexedDB; the server is only involved when sharing
- **Zero-knowledge server**: AES-GCM key generated client-side, travels only in the
  URL fragment (`#key`), never sent to the backend
- **One blank page**: no folders, no dashboards — a list of local notes + one editor
- **Privacy is a feature**: no accounts, no tracking, plaintext never leaves the
  device except on explicit user action (export / share)

## Architecture

### Frontend (TypeScript + Svelte)

- Editor: markdown editor (CodeMirror or plain textarea for v1) with optional
  rendered preview toggle
- Local persistence: IndexedDB via `idb`, autosave
- Crypto: Web Crypto API, AES-GCM-256. Key gen → encrypt → export key to URL
  fragment
- Voice input: Web Speech API (`webkitSpeechRecognition` on iOS Safari),
  appends transcript at cursor
- AI panel: collapsible sidebar
  - API key stored in `sessionStorage` only (never persisted to disk)
  - Calls go directly browser → Anthropic/OpenAI (no server proxy)
  - Note content sent as context only on explicit user action
- PWA manifest for "add to home screen" on mobile

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
2. An encrypted snapshot of the note's Yjs document seeds the server's update log
3. Links:
   - View: `https://app/n/{id}#{key}` (read-only)
   - Owner/editor: `https://app/n/{id}#{key}:{edit_token}` (can edit)
4. All participants sync live over an encrypted WebSocket relay: every Yjs update
   is encrypted client-side before broadcast — the server never sees plaintext
5. Edits converge via CRDT; no conflicts, no last-write-wins data loss
6. The update log is compacted with an encrypted snapshot when it grows large

## Features

### Export to disk

- "Export" button → serialize note (markdown, plus optional AI chat transcript
  appended as a section) → browser download as `{title-or-id}.md`
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

### AI chat

- BYOK (Anthropic/OpenAI), key in `sessionStorage`, client-direct calls
- "Send note as context" button — note content only leaves the device on
  explicit action

### Voice input

- Web Speech API dictation, transcript appended at cursor
- Browser-native, zero dependencies

## Roadmap

| Milestone | Scope                                                              |
| --------- | ------------------------------------------------------------------ |
| **M1**    | Skeleton: repo setup, Axum hello-world, Svelte frontend, CI (fmt/clippy) |
| **M2**    | Local notes: markdown editor + IndexedDB autosave, note list       |
| **M3**    | Share: crypto module, blob API, share/view links, mailto-with-link flow |
| **M4**    | AI chat: BYOK panel, streaming responses, send-note-as-context     |
| **M5**    | Voice + Export: Web Speech API dictation, plaintext export-to-disk |
| **M6**    | Polish: PWA, mobile UX, self-host docs, MIT license                |

## Explicitly Out of Scope (v1)

- Presence/awareness (collaborator cursors, names)
- Accounts
- Rich text, images, drawing
- Server-side AI proxying

## Open Decisions

- Svelte vs React (Svelte preferred for minimalism)
- SQLite vs Postgres (SQLite preferred for self-hosting simplicity)
