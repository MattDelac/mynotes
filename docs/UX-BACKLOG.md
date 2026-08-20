# UX Backlog

Plan of record for the overnight UX loop. Take the top unblocked item, implement the
smallest useful slice with tests, verify (`pnpm lint && pnpm check && pnpm test`, plus
`pnpm screenshots` for any visible UI change), mark it done with one line of evidence,
and re-prioritize. Items are ordered by user impact.

## Audit evidence (2026-08-20, iteration 1)

App audited via Playwright against `pnpm preview` (desktop 1280×800, mobile 390×844,
light + dark). Ground truth read from `EditorView.state.doc` — **DOM `textContent` is
unreliable for editor content because `cm-conceal.ts` hides marks on inactive lines
(by design)**; several first-pass readings (e.g. "Enter deletes `##`") turned out to be
concealment, not data loss.

What already works well (do not regress):

- One blank page, instant start, `Start typing…` placeholder
- Typora-style mark concealment on inactive lines (`cm-conceal.ts`)
- Styled headings in the editor (serif, size scale)
- List continuation on Enter (bullets, ordered auto-numbering, blockquotes) via
  `markdownKeymap` in `@codemirror/lang-markdown` (`markdown()` adds it by default);
  Backspace on an empty item dedents/removes the marker
- Table Enter keymap (`cm-table.ts`): separator insert, row continuation, empty-row delete
- Cmd/Ctrl+click opens links in edit mode (`cm-links.ts`)
- Preview toggle (`marked` + DOMPurify, `gfm: true, breaks: true`)
- Sidebar (hover zone desktop / drawer mobile), note switch, new/delete, share, export/import
- Shortcuts: Mod+N new session, Mod+E export, Mod+O sidebar
- 720px content width; mobile line length ~358px (comfortable)

## Backlog

### 1. Tab must not drop editor focus; Tab/Shift+Tab indents list items

- Evidence: pressing Tab inside the editor moves focus to `<body>` (verified via
  Playwright; no Tab binding exists anywhere in `Editor.svelte`). Any list-heavy
  writing session is interrupted the moment a user hits Tab.
- Scope: add a Tab/Shift+Tab binding in `Editor.svelte`. Tab indents the current line
  (preserving list markers; one level = marker kept + 4 spaces, or standard indent on
  non-list lines); Shift+Tab dedents. Must compose with the table Enter keymap and the
  `markdownKeymap` continuation.
- done-when: e2e — type `- x`, press Tab: line indents, focus stays in the editor;
  Shift+Tab dedents; Tab on a plain line inserts spaces; focus never leaves content.

### 2. Preview tables: borders, padding, horizontal overflow scroll

- Evidence: `app.css` has **no** `.preview table/th/td` rules. Computed th/td padding is
  1px (UA default) with no borders — tables render borderless and cramped, even though
  the app actively encourages tables (Enter keymap in `cm-table.ts`).
- Scope: CSS only in `app.css` — `.preview table { display: block; overflow-x: auto;
  max-width: 100%; border-collapse: collapse }`, th/td with 1px `var(--border)` borders
  and ~0.4em 0.8em padding. Keep it minimal (no zebra striping).
- done-when: e2e — `article td` computed padding ≥ 6px and 1px border; a 10-column
  table does not overflow the page viewport on mobile (scrolls within the table);
  screenshots regenerated.

### 3. Editor renders `~~strikethrough~~` (preview/editor fidelity)

- Evidence: the lezer grammar bundled in `@codemirror/lang-markdown` 6.5.1 has no
  `StrikethroughMark` (grep of the dist = 0 matches). `~~gone~~` shows raw marks with
  `tok-meta` and no styling in the editor, while the preview (marked GFM) renders
  strikethrough. `cm-conceal.ts` already lists `StrikethroughMark`, but the parser
  never emits it.
- Scope: small ViewPlugin (or extension of `cm-conceal.ts`) adding a `Decoration.mark`
  (line-through) plus concealment for `~~…~~` spans in non-code contexts.
- done-when: unit test for the decorations; e2e — `~~gone~~` shows line-through when
  the cursor is on another line and reveals raw `~~gone~~` when clicked; screenshots
  regenerated.

### 4. Input rules: code-fence auto-close and link `[]()` auto-pair

- Evidence: typing ``` and pressing Enter leaves the cursor on a bare empty line — no
  closing fence (verified). Typing `[]` does not insert `()`. Both are standard in
  Obsidian/Typora/VSCode and are invisible ergonomics.
- Scope: `EditorView.inputRules` in `Editor.svelte` (no new dependency). (a) After
  ``` + Enter, insert a closing ``` with the cursor on the line between (skip if one
  already follows). (b) Typing `]` immediately after an empty `[` inserts `()` with
  the cursor inside. Neither fires inside fenced code.
- done-when: e2e — ``` + Enter yields the cursor between two fences; `[]` yields
  `[]|()`; both no-ops inside a fenced code block.

### 5. Opening links on mobile (touch) in edit mode

- Evidence: `cm-links.ts` requires Meta/Ctrl+click — impossible on a touch device, and
  there is no long-press handler, so mobile users can only open a link by toggling
  preview.
- Scope: add a touch long-press (~500ms) handler in `cm-links.ts` that opens the link
  under the touch; suppress the follow-up click so the cursor is not moved.
- done-when: e2e (mobile context) — long-press on a link in edit mode opens it in a
  new tab; a short tap still just places the cursor.

### 6. Title treatment: first line displays as a title without requiring `# `

- Evidence: `noteTitle()` (db.ts:58) already treats the first line as the title in the
  header/sidebar (stripping `#`). But in the editor and preview, a first line without
  `# ` renders as plain body text, so users must type `# ` to get title treatment.
- Scope (display-only; the stored markdown is never modified): editor — style the
  first non-empty line as a title (larger, serif) when it is not already a heading;
  preview — render that line with h1-equivalent styling (wrap the first paragraph in a
  class during `renderMarkdown`, do not emit a real `h1`). Export stays byte-identical.
- done-when: e2e — a note starting `Meeting Notes` (no `#`) shows title styling in
  editor and preview; a note starting `# Title` is unchanged; exported `.md` is
  byte-identical to the stored content; screenshots regenerated.

### 7. Keyboard shortcut for new note

- Evidence: Mod+N = new **session** (`AppHeader.svelte`), Mod+E = export, Mod+O =
  sidebar — but creating a **note** (the common action) has no shortcut and is
  sidebar/drawer-only.
- Scope: bind Mod-Shift+N to "new note in current session" in `AppHeader.svelte`
  (keep Mod+N as-is).
- done-when: e2e — Mod-Shift-N creates and opens a new note in the current session.

### 8. Keyboard shortcut for the preview toggle

- Scope: bind Mod-Shift-P to toggle preview in `AppHeader.svelte`.
- done-when: e2e — the shortcut toggles between editor and preview.

### 9. Extend the table keymap: cell navigation, deletion, alignment

- Depends on item 1 (Tab semantics must exist first).
- Scope slices: (a) Tab inside a table moves to the next cell, creating one at row end;
  (b) Backspace on an empty cell merges with the previous cell; (c) `:---:` alignment
  renders aligned in preview.
- done-when (per slice): e2e for each behavior in `tables.spec.ts`; screenshots
  regenerated for (c).

### 10. Images: committed design doc first (implementation later)

- Evidence: seed requirement — the first deliverable is a design doc, not code.
- Scope: write `docs/IMAGES.md` covering: client-side AES-GCM encryption of image bytes
  (per-session key or per-image keys), opaque blob upload endpoint reusing the
  zero-knowledge API (new `POST /blobs`-style endpoint or reuse of `/notes` with a
  kind), size caps + rate limits via existing `api/src/config.rs` abuse limits,
  markdown syntax (`![alt](mynotes:blobId)` resolved client-side), rendering in editor
  + preview, and what happens when a session is shared.
- done-when: `docs/IMAGES.md` committed, reviewed against the hard rules (zero-knowledge
  stays intact, markdown storage format unchanged, no new dependencies).

### 11. Chore: remove dead editor API

- Evidence: `insertAtCursor` and `focus` are exported from `Editor.svelte` but unused
  anywhere (grep over `src/`).
- done-when: removed; `pnpm check` green.

## Parked (noticed, not yet scoped)

- Mobile header icon density: up to 5 icons (list, share, preview, menu, leave) at
  390px — consider moving preview toggle into the menu on mobile.
- `---` directly under a paragraph line creates a setext h2 (standard markdown footgun;
  Obsidian/Typora behave the same — no action).
- No presence/awareness — explicitly out of scope per `docs/PLAN.md`.
- `screenshots.spec.ts` is excluded from the default vitest run (`testIgnore`) and runs
  via the screenshots workflow — keep it that way.
