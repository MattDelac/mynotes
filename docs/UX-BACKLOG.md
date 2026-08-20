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

### 1. DONE (2026-08-20): Tab/Shift+Tab indents list items; focus never leaves the editor

- Evidence: new `src/lib/cm-indent.ts` keymap (`indentKeymap`, wired in `Editor.svelte`)
  + 16 unit tests (`cm-indent.test.ts`) + 5 e2e tests (`e2e/indent.spec.ts`), all green,
  full e2e suite 37 passed. Tab on `- x` → `  - x` with focus retained; Tab on the second
  item nests under the first (2-space GFM-safe step); Shift+Tab dedents one level; plain
  lines get 4 spaces; repeated Tab/Shift+Tab never drops focus to `<body>`.
- Semantics chosen: list items nest under the previous item (bullet moved to the
  previous item's content column, always <4 extra so GFM never renders a code block);
  standalone items cap at 3-space indent (GFM top-level items must start within 3
  columns); ATX headings and table rows are no-ops (4-space indent would break them in
  preview); fenced code indents 4 spaces like plain code.
- For item 9: Tab/Shift+Tab on table rows is deliberately a no-op for now; slice (a)
  (cell navigation) will define the behavior that replaces it.

### 2. DONE (2026-08-20): Preview tables: borders, padding, horizontal overflow scroll

- Evidence: `app.css` now has `.preview table { display: block; overflow-x: auto;
  max-width: 100%; border-collapse: collapse }` + 1px `var(--border)` borders and
  0.4em/0.8em padding on th/td, plus `.preview { min-width: 0 }` (see note below).
  Two new e2e tests in `e2e/tables.spec.ts`: cell metrics (padding ≥ 6px, 1px solid
  border on th and td) and a 10-column table on a 390px viewport (table
  `overflow-x: auto`, `scrollWidth > clientWidth`, table box and `body.scrollWidth`
  both ≤ 390px). Full e2e suite 39 passed.
- Note: `min-width: 0` on `.preview` was required — `main` is a flex container and the
  article's default `min-width: auto` let the wide table stretch the article past the
  viewport, defeating `max-width: 100%` (classic flexbox min-content trap).
- Follow-up (needs a docker-capable env): add a small table to the `screenshots.spec.ts`
  fixture and regenerate with `pnpm screenshots` so the styling is visible in the
  committed PNGs. Not done in-iteration: docker cannot run containers in the gnhf
  worktree env (runc cgroup-BPF "operation not permitted"), and host-rendered PNGs
  differ byte-for-byte from the committed docker ones (all 16 differ even with an
  unchanged fixture — font environment), so committing them would break the CI
  screenshots leg. Current committed PNGs remain valid: the fixture has no tables and
  the new CSS cannot affect table-less content.

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

- Item 1 is done: Tab/Shift+Tab are live but no-op on table rows (see item 1 note);
  slice (a) should replace that no-op with cell navigation.
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

- Screenshot regeneration is impossible in the gnhf container env: docker cannot start
  containers (runc `bpf_prog_query(BPF_CGROUP_DEVICE): operation not permitted`), and
  `pnpm screenshots:host` output is not byte-identical to the committed docker PNGs
  (all 16 differ even with an unchanged fixture — font environment differs). For
  visible-UI items, verify with e2e computed-style/behavior assertions and leave the
  committed PNGs untouched unless they would actually change (e.g. fixture gains the
  new element); regenerate only from a docker-capable machine.

- `defaultKeymap` (and `markdownKeymap`) ship no Tab binding — `@codemirror/commands`
  exports an unused `indentWithTab` helper, but its generic `indentMore`/`indentLess`
  are code-oriented (tab-size based) and were unsuitable for markdown lists.
- With `marked` `breaks: true`, a 4-space-indented plain line after a paragraph renders
  as a lazy continuation with a leading space (`<p>para<br> indented</p>`) — visually
  harmless, no action.
- Mobile header icon density: up to 5 icons (list, share, preview, menu, leave) at
  390px — consider moving preview toggle into the menu on mobile.
- `---` directly under a paragraph line creates a setext h2 (standard markdown footgun;
  Obsidian/Typora behave the same — no action).
- No presence/awareness — explicitly out of scope per `docs/PLAN.md`.
- `screenshots.spec.ts` is excluded from the default vitest run (`testIgnore`) and runs
  via the screenshots workflow — keep it that way.
