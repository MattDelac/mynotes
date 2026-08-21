# UX Backlog

Plan of record for the overnight UX loop. Take the top unblocked item, implement the
smallest useful slice with tests, verify (`pnpm lint && pnpm check && pnpm test`, plus
`pnpm screenshots` for any visible UI change), mark it done with one line of evidence,
and re-prioritize. Open items are listed by priority (numbering is stable across runs;
done items are kept in place as the audit trail).

## Status (2026-08-21, run 2, iteration 1)

- Former item 10 (images) is **CLOSED by product decision** — pruned per the mandate.
  The record is `docs/adr/0001-documents-stay-pure-markdown.md`; no image/blob work may
  be re-added without explicitly re-opening that ADR.
- Seeded the agreed writing-experience feature set as items 13–17 (per-iteration slices
  with done-when lines) and re-prioritized: formatting first (most frequent writing
  action), then headings, links, task lists. Item 18 (undo granularity) was added the
  same day — a gap found while implementing item 13, which is now DONE.
- Chord reservation audit for the new bindings is in
  "Chord reservation audit (2026-08-21)" below — the mandate's Mod+Shift+X, Mod+1..6 and
  Mod+0 do **not** survive the audit; documented substitutions: Mod+Alt+X, Mod+Alt+1..6,
  Mod+Alt+0, Mod+Alt+C.

## Audit delta (2026-08-21, run 2, iteration 1)

Probes run against the installed packages (no Playwright needed):

- `markdown()` from `@codemirror/lang-markdown` ships `pasteURLAsLink` **enabled by
  default** (config `pasteURLAsLink: true`): pasting a URL over a selection turns the
  selection into a link with the pasted URL as target. Already live in the app; item 16
  documents it rather than re-building it.
- The GFM grammar (`@lezer/markdown`) **parses task lists**: `- [ ] x` →
  `BulletList > ListItem > Task > TaskMarker "[ ]"` (+ `Task "[x]"`). So task lines are
  already recognized by the syntax tree — item 17b can key on the `TaskMarker` node.
- `markdownKeymap`'s Enter **already continues task items** (probed with the real
  `insertNewlineContinueMarkup`): `- [ ] buy milk` + Enter → `- [ ] ` (cursor after the
  marker, new task unchecked), and Enter on an empty task item removes the marker (list
  exits). Item 17a is verification + regression lock, not new behavior.
- `marked` v18 renders task lists as `<li><input disabled="" type="checkbox">…</li>` —
  the preview checkbox is **disabled by default**; item 17c must make it interactive
  (custom renderer or post-process) and wire a click back into the document.

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
- `~~strikethrough~~` in the editor: concealed tildes on inactive lines, line-through
  on the text (grammar support comes from transitive `@lezer/markdown`, see item 3)
- List continuation on Enter (bullets, ordered auto-numbering, blockquotes) via
  `markdownKeymap` in `@codemirror/lang-markdown` (`markdown()` adds it by default);
  Backspace on an empty item dedents/removes the marker
- Table Enter keymap (`cm-table.ts`): separator insert, row continuation, empty-row delete
- Table cell navigation (`cm-table.ts`): Tab to the next cell / new row at row end
  (separator added when needed), Shift+Tab to the previous cell, Backspace on an
  empty cell merges with the previous cell (see item 9)
- Table column alignment in preview: `:---` / `:-:` / `---:` separator cells render
  left/center/right aligned (see item 9 slice c)
- Input rules (`cm-input-rules.ts`): Enter after an opening ```/~~~ fence auto-closes it
  (cursor parked between the fences); `]` after an empty `[` yields `[]()` with the
  cursor inside; both no-ops inside fenced code
- Fence delimiter marks stay visible on inactive lines (fixed iteration 5; see item 4)
- Cmd/Ctrl+click opens links in edit mode (`cm-links.ts`)
- Long-press (~500 ms) on a link in edit mode opens it in a new tab on touch devices
  (`cm-links.ts`), with haptic feedback and no caret movement (see item 5)
- Title treatment: a plain (non-heading) first line renders with h1 styling in both
  editor (`cm-title.ts`) and preview (`p.note-title`), display-only (see item 6)
- Preview toggle (`marked` + DOMPurify, `gfm: true, breaks: true`)
- Sidebar (hover zone desktop / drawer mobile), note switch, new/delete, share, export/import
- Shortcuts: Mod+N new session, Mod+E export, Mod+O sidebar, Mod+Alt+N new note,
  Mod+Alt+P preview toggle (see items 7, 8 and 12 — the Alt chords were chosen because
  the original Mod-Shift+N / Mod-Shift-P proposals are browser-reserved chords)
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

### 3. DONE (2026-08-20): Editor renders `~~strikethrough~~` (preview/editor fidelity)

- **Audit correction:** the iteration-1 premise was wrong. `@codemirror/lang-markdown`
  6.5.1's GFM grammar **does** parse `~~gone~~` as `Strikethrough` +
  `StrikethroughMark` — but the grammar lives in the transitive dep
  `@lezer/markdown@1.7.2`, not in `lang-markdown`'s own dist, so the original
  dist-grep (0 matches) missed it. The app already wires everything up:
  `StrikethroughMark` is in `cm-conceal.ts`'s concealed set, the grammar tags the
  inner text `tags.strikethrough`, and `Editor.svelte`'s HighlightStyle styles that
  tag with `line-through`.
- Evidence: no code change needed — behavior verified and regression-locked with
  4 e2e tests (`e2e/strikethrough.spec.ts`: raw marks on the active line; concealed
  tildes + computed `text-decoration-line: line-through` on an inactive line; click
  reveals raw marks with the document unchanged; preview renders `<del>` with
  line-through) and 3 unit tests (`src/lib/cm-conceal.test.ts` pins the grammar
  premise: `Strikethrough`/`StrikethroughMark` emitted for `~~…~~`, not for `~x~` or
  unclosed runs). Full suite: 86 unit + 43 e2e passed.
- Screenshots: none regenerated — the committed fixtures contain no strikethrough so
  the PNGs cannot change (and docker is unavailable in this env, see Parked).
- Adjacent observation (parked): lezer's GFM also parses single-`~` as `Subscript`
  (muted mark style in editor) while the marked preview renders `~x~` literally —
  cosmetic mismatch only, no action.

### 4. DONE (2026-08-20): Input rules: code-fence auto-close and link `[]()` auto-pair

- Evidence: new `src/lib/cm-input-rules.ts` (`inputRulesKeymap`, wired in `Editor.svelte`)
  + 21 unit tests (`cm-input-rules.test.ts`) + 6 e2e tests (`e2e/input-rules.spec.ts`),
  all green; full suite 109 unit + 49 e2e passed. ``` + Enter (or `~~~`) yields the cursor
  between two fences with the info string kept on the opening line only; `]` after an
  empty `[` yields `[]()` with the cursor between the parens; both no-ops inside fenced
  code; Enter on an already-closed fence just adds a newline.
- **Scope correction:** the original plan said `EditorView.inputRules` — that API does
  not exist in CodeMirror 6 (it is a CM5 concept; no CM6 package exports it, verified in
  the installed `@codemirror/*` dists and the current reference manual). Implemented as
  keymap bindings instead (the same mechanism as `closeBracketsKeymap`), which is
  strictly better: they fire only on real keypresses, never on paste or remote (y-collab)
  changes. Fence detection uses the syntax tree: the line must parse as a `FencedCode`
  that starts on that line and has no body yet (so closed blocks, blocks with content,
  and fence lines inside an outer fence are all correctly skipped).
- Side fix found while verifying: the opening ``` of a fence block at the top of a note
  was concealed on inactive lines (closing fence stayed visible) — `cm-conceal.ts`'s
  CodeMark exception called `isInsideFencedCode`, which resolves with `side: -1` and
  misses the very first node of the document (resolves to `Document`). Added
  `isFencedCodeMark` (side `+1` resolve, parent walk) as the exception; 2 unit tests pin
  the node-structure premise (fence marks live under `FencedCode`, inline code under
  `InlineCode`).
- Follow-up (parked, optional): `]`-pairing means writing `[text](url)` requires typing
  `]` then `(`; if that feels awkward in real use, revisit the pairing direction
  (VSCode pairs `[` → `[]` instead).

### 5. DONE (2026-08-20): Opening links on mobile (touch) in edit mode

- Evidence: `clickableLinks` in `src/lib/cm-links.ts` now owns touch too: a long-press
  (500 ms) on a link opens it in a new tab (`noopener,noreferrer`) with haptic feedback
  (`navigator.vibrate`); the press cancels on >10 px finger movement or a second finger;
  when the press fires, `touchend` is consumed (returns `true` → CM6 prevents the default,
  so no synthetic mouse events follow and the caret does not move); a follow-up
  `detail: 0` click within 800 ms / 20 px of a just-opened link is also consumed as
  defense in depth (some Android browsers fire it anyway). Short taps are untouched —
  the browser places the caret natively (CM6 deliberately ignores the synthetic
  mousedown within 2 s of a touch). 6 e2e tests in `e2e/mobile-links.spec.ts` (mobile
  touch context, dispatched `TouchEvent`s): long-press opens with the right url +
  `_blank`, short tap opens nothing and is not consumed, long-press does not move the
  caret and its synthetic click is consumed, non-link text opens nothing, finger
  movement cancels, a second finger cancels. Full suite: 109 unit + 55 e2e passed
  (5 pre-existing intentional skips).
- Screenshots: unchanged — the committed fixtures use `fill()` and no touch interaction,
  so the handler cannot affect the PNGs.
- done-when note: "a short tap still just places the cursor" is only half-verifiable in
  e2e — caret placement on a real tap is browser-native contenteditable behavior, which
  synthetic touches cannot trigger; the test instead pins that the tap is left
  unhandled (not consumed, nothing opened).

### 6. DONE (2026-08-20): Title treatment — first line displays as a title without `# `

- Evidence: new `src/lib/cm-title.ts` — `titleDecorationSet(state)` (pure) + `titleLines`
  StateField: finds the first non-empty line, walks top-level syntax nodes, and adds a
  `Decoration.line` with class `cm-note-title` **only when the block is a plain
  `Paragraph`** (ATX/setext headings, lists, fences, quotes, and tables are skipped —
  node names verified: `ATXHeading1`, `SetextHeading1`, `BulletList`, `FencedCode`,
  `Blockquote`, `Table`). Wired in `Editor.svelte` with `EditorView.decorations.of(view
  => view.state.field(titleLines))` and an h1-matching theme rule (1.7em/700/serif/1.3).
  Preview: `markdown.ts` splits into `titleWrappedHtml` (lexer → first non-`space`
  non-empty top-level `paragraph` token → `marked.parser` subset with `<p>` replaced by
  `<p class="note-title">`) + `renderMarkdown` (DOMPurify). `.preview p.note-title` in
  `app.css` mirrors the h1 metrics. 14 unit tests (`cm-title.test.ts`), 9 unit tests
  (`markdown.test.ts`), 6 e2e tests (`e2e/title.spec.ts`: editor class + 28.56px/700
  computed style, ATX and setext left alone, preview wrap + computed style, heading
  preview unchanged, and byte-identical export of a `#`-less note). Full suite: 132
  unit + 61 e2e passed.
- Scope notes: editor styles only the first non-empty line while the preview styles the
  whole first paragraph (both per the original scope) — a multi-line first paragraph
  therefore reads slightly differently across the two views; the fix is a blank line
  between title and body, which is also what the sidebar title (`noteTitle`) assumes.
  Display-only: stored markdown, exports, and the zero-knowledge flow are untouched
  (export byte-identity locked by e2e).
- Screenshots: none regenerated — the committed fixture starts with `# Focus Mode`
  (an ATX heading), which is excluded from title treatment, so no PNG can change
  (docker still unavailable in this env, see Parked).

### 7. DONE (2026-08-20): Keyboard shortcut for new note (Mod+Alt+N)

- Evidence: `AppHeader.svelte`'s document-level keydown now maps Mod+Alt+N to
  `onMenuAction('newNote')` (checked before the Mod+N branch), and `s/[id]`
  handles `newNote` behind the `canWrite` guard. 3 e2e tests
  (`e2e/shortcuts.spec.ts`): the shortcut creates and opens a new note in the
  same session (typed into the fresh note, sidebar lists both), Ctrl+N still
  starts a new session, and the shortcut is a no-op in a read-only shared
  session. Full suite: 132 unit + 64 e2e passed (5 pre-existing skips).
- **Key change from the original scope (Mod-Shift+N):** Mod-Shift+N is a
  browser-reserved chord (new private/incognito window on Chrome/Firefox/
  Safari) — the browser consumes it before the page, so no web app can bind
  it. The e2e suite cannot detect this: CDP key dispatch bypasses the browser
  accelerator layer (probed: Ctrl+N, Ctrl+Shift+N and Ctrl+Alt+N all reach
  the page in headless). Mod+Alt+N is not reserved in any major browser.
  Matching detail: on Mac, Option turns `n` into a different `e.key` (e.g.
  `∩`), so the handler matches `e.code === 'KeyN'` there; elsewhere it matches
  `e.key.toLowerCase() === 'n'` so AltGr (Ctrl+Alt) character typing on
  European layouts never triggers it. See item 12 for the pre-existing Mod+N
  binding, which has the same reserved-chord problem.
- Scope notes: the frozen legacy `n/[id]` page does not handle `newNote`, so
  the shortcut is a no-op there. Screenshots unchanged — a keydown handler has
  no visual effect and the fixtures never press the new chord.

### 8. DONE (2026-08-20): Keyboard shortcut for the preview toggle (Mod+Alt+P)

- Evidence: `AppHeader.svelte`'s document-level keydown now maps Mod+Alt+P to
  `onTogglePreview?.()`, gated on `!readOnly` to mirror the preview button's visibility
  (the button only renders when `!readOnly && onTogglePreview`). 2 e2e tests
  (`e2e/shortcuts.spec.ts`): the shortcut toggles between editor and preview and back,
  and it is a no-op in a read-only shared session (locks the guard). Full suite green:
  132 unit + 66 e2e passed (5 pre-existing skips).
- **Key change from the original scope (Mod-Shift-P):** Mod-Shift-P is a
  browser-reserved chord — on Chrome (Windows/Linux) Ctrl+Shift+P is "open a new tab
  and start a web search," consumed by the browser before the page, so it would be a
  dead binding on the primary desktop platform. Same class of bug as item 7's
  Mod-Shift+N and item 12's Mod+N. Mod+Alt+P (Ctrl+Alt+P / Cmd+Option+P) is not
  reserved in any major browser. Matching detail mirrors the new-note handler: on Mac,
  Option alters `e.key`, so it matches `e.code === 'KeyP'`; elsewhere it matches
  `e.key.toLowerCase() === 'p'` so AltGr character typing never triggers it.
- Screenshots: none regenerated — a keydown handler has no visual effect and the
  fixtures never press the new chord (docker still unavailable in this env, see Parked).

### 9. DONE (2026-08-20, all slices): Table cell navigation — Tab/Shift+Tab between cells, Backspace merges empty cells, `:---:` alignment renders in preview

- Evidence: `tableTab`/`tableShiftTab` in `src/lib/cm-table.ts` + Tab/Shift+Tab
  bindings in `tableKeymap`; `Editor.svelte` now lists `tableKeymap` before
  `indentKeymap`, so cell navigation owns Tab on pipe rows and everything else
  (lists, plain lines, fences) falls through to the indent keymap unchanged
  (16 new unit tests in `cm-table.test.ts`, 6 new e2e tests in `e2e/tables.spec.ts`;
  full suite green: 148 unit + 72 e2e, 5 pre-existing skips).
- Behavior: Tab moves the cursor to the first content character of the next cell
  (a cursor sitting on a pipe goes to the cell after that pipe); in the last cell
  Tab inserts a new row below, sized to the current row's column count, adding a
  `| --- |` separator when the row isn't part of a table yet (mirrors the existing
  Enter behavior, so tabbing out of a lone `| a | b |` row builds a valid GFM table);
  Shift+Tab moves to the previous cell and is a no-op in the first cell; all of it
  no-ops inside fenced code and on non-pipe lines.
- e2e note: after Enter in a header row the cursor lands on the second space of the
  first cell of the new `|  |  |` row (`rowStart + 2`), so typed text lands there —
  table e2e expectations must account for the 2-space empty cells.
- Slice (b) evidence (2026-08-20): `tableBackspace` in `src/lib/cm-table.ts` + a
  Backspace binding in `tableKeymap`. When the cursor is in an empty cell (not the
  first), Backspace moves the cursor to the end of the previous cell's content — or
  just before the following pipe when the previous cell is also empty — leaving all
  pipes intact: markdown pipe tables cannot express column spans, so a "merge" is a
  selection-only move (Word/Docs-style), and typing continues in the previous cell.
  No-op (falls through to default Backspace) in the first cell, on a pipe, in a
  non-empty cell, in a single-cell row, on non-pipe lines, and inside fenced code.
  12 unit tests (`cm-table.test.ts`) + 4 e2e tests (`e2e/tables.spec.ts`); full suite
  green: 160 unit + 76 e2e passed (5 pre-existing skips). Screenshots unaffected —
  keydown-only change and the fixtures never press Backspace in a table.
- Slice (c) evidence (2026-08-20): `:---:` alignment **already rendered** in preview with
  zero code changes — `marked` v18 emits the deprecated-but-supported `align="left|center|right"`
  attribute on `th`/`td` from the separator row, DOMPurify's default allow list keeps `align`,
  and Chromium applies it. Locked with 1 unit test (`markdown.test.ts`, pins marked's
  `align`-attribute output — note `renderMarkdown` is not unit-testable in node, the
  dompurify default export there is a factory with no `sanitize`) and 1 e2e test
  (`e2e/tables.spec.ts`: computed `text-align` left/center/right on th and td, unaligned
  columns fall back to UA defaults `center`/`start`). Full suite: 161 unit + 77 e2e
  passed (5 pre-existing skips). Screenshots unaffected — the committed fixture has no
  tables, so no docker regeneration was needed (the earlier "blocked on docker" note
  conflated *showing* alignment in the PNGs with the feature itself working).

### 10. CLOSED (2026-08-21): Images — abandoned by product decision

- Closed and pruned per the run-2 mandate. The images experiment (design doc +
  implementation phases 1–2) was abandoned; the record is
  `docs/adr/0001-documents-stay-pure-markdown.md`. No binary media of any kind — do not
  resurrect the blob API or `mynotes:` refs without explicitly re-opening the ADR.

### 13. DONE (2026-08-21): Formatting commands Mod+B bold + Mod+I italic (shared engine, selection-or-word toggle)

- Evidence: new `src/lib/cm-format.ts` — pure `applyFormat({ doc, from, to, open,
  close })` + `formatCommand(mark, undoManager)` + `formatKeymap(undoManager)`
  (`Mod-b` → `**`, `Mod-i` → `*`), wired in `Editor.svelte` after `inputRulesKeymap`.
  21 unit tests (`cm-format.test.ts`: every selection/word/empty case for both marks,
  nested-mark unwrap, `insideFencedCode` node walk) + 6 e2e tests
  (`e2e/formatting.spec.ts`: selection wrap+toggle, word wrap with no selection,
  blank-note pair insert, italic, undo + concealment invariant, read-only no-op).
  Full suite green: 188 unit + 83 e2e (5 pre-existing skips).
- Semantics: selection → wrap, then the wrapped content stays selected so a repeat
  press unwraps; selection flanked by the exact marks (or including them) → unwrap;
  cursor on a word → wrap/unwrap the word (word = maximal run of chars that are
  neither whitespace nor the mark's own char — that is what makes `**bold**` resolve
  to `bold`, not `**bold**`); cursor between an empty pair → remove it; else insert
  the pair with the cursor between. No-op when not editable, on multi-range
  selections, or when the cursor/selection touches a fenced code block.
- Undo: `undoManager.stopCapturing()` before/after the dispatch — without it the
  wrap merges into the surrounding typing burst, because y-codemirror applies ALL
  local edits with one Yjs origin and `Y.UndoManager`'s 5 s same-origin grouping
  swallows the command (see item 18 and Parked).
- Screenshots: keymap-only change, fixtures never press Mod+B/Mod+I — committed PNGs
  cannot change; no regeneration needed (docker still unavailable here, see Parked).

### 14. Formatting commands: Mod+Alt+X strikethrough, Mod+Alt+C inline code

- Evidence: item 13's engine is mark-agnostic (`open`/`close` strings); the two
  bindings are a few lines + tests.
- Scope: extend `formatKeymap` with `Mod-Alt-x` → `~~` and `Mod-Alt-c` → `` ` ``;
  e2e: word-wrap + toggle for each, and the existing concealment keeps applying
  (inactive-line tildes stay hidden — `cm-conceal.ts` already conceals `~~`; verify
  inline code marks are also concealed and add them if not).
- done-when: both commands work with selection-or-word semantics, unit + e2e green.

### 15. Heading toggles: Mod+Alt+1..6 set the line's level, Mod+Alt+0 removes it

- Evidence: no heading shortcuts exist; lezer tags ATX headings
  (`ATXHeading1..6`, verified in item 6's work).
- Scope: `headingCommand(level)` in `cm-format.ts` (or a sibling module): on the cursor
  line, replace an existing ATX prefix with `#`×level, strip it when level is 0
  (Mod+Alt+0), no-op inside fenced code / on table rows; cursor/selection preserved on
  the line. Setext headings: out of scope for v1 (document; ATX only — the app's own
  title treatment and concealment are ATX-centric).
- done-when: unit tests for set/remove/replace/no-op cases; e2e for Mod+Alt+1,
  Mod+Alt+3 overwrite, Mod+Alt+0 removes; full suite green.

### 16. Link command: Mod+K

- Evidence: `pasteURLAsLink` (built into `markdown()`, default on) already turns a
  pasted URL over a selection into `[selection](pasted-url)` — document that in the
  backlog (done here) so users/iterations know the paste path exists; Mod+K is the
  deliberate counterpart.
- Scope: `linkCommand()` in `cm-format.ts`:
  - selection → `[sel](url)` where url is auto-filled from the clipboard when it holds
    a URL (clipboard read via `navigator.clipboard.readText()`, best-effort — on
    denial/failure fall back to empty url), cursor inside `()`;
  - no selection, cursor on a word → the word becomes the label, cursor inside `()`;
  - else insert `[]()` with the cursor inside `[]`;
  - toggle: cursor/selection already inside a plain `[label](url)` → unwrap to the
    label; no-op inside fenced code.
- done-when: unit tests for the pure range computation; e2e for selection + clipboard
  URL (grant clipboard permission in the test), word label, bare `[]()` insert,
  unwrap, read-only no-op; full suite green.

### 17. Task lists (checkboxes)

- Slice (a) — verify + regression-lock continuation (verification only, no new
  behavior, see Audit delta 2026-08-21): Enter after `- [ ] x` continues with
  `- [ ] `, Enter on an empty task item exits the list, checked items continue
  unchecked. done-when: unit tests driving `insertNewlineContinueMarkup` + e2e
  lock the three behaviors; full suite green.
- Slice (b) — editor bracket click: clicking strictly on the `[ ]`/`[x]` token
  (the `TaskMarker` node) toggles it (`[ ]` ↔ `[x]`, one-char change through a
  dispatch so y-collab/undo see it); clicks anywhere else on the line place the
  cursor normally (return false / let the default happen). done-when: unit tests
  for the token-range computation; e2e: clicking the bracket toggles, clicking
  the word does not toggle and moves the caret; read-only view: click is a no-op.
- Slice (c) — preview checkboxes: make marked's `disabled` task checkbox
  interactive (custom `marked` extension/renderer emitting our own
  `<input type="checkbox" data-task-line={n}>`), wire a click handler in the
  preview container that maps back to the corresponding `- [ ]` line in the
  document and toggles it; disabled (no handler) in read-only shared views.
  done-when: e2e: clicking a preview checkbox flips the stored markdown line
  (verified via export or editor state after toggling back), read-only preview
  checkbox does nothing; full suite green.

### 18. Undo granularity: coarse undo steps for the non-format keymap commands

- Evidence: `y-codemirror.next` 0.3.5's `YSyncPluginValue.update` runs
  `ytext.doc.transact(fn, this.conf)` for **every** local dispatch — one Yjs origin
  for everything. `Y.UndoManager`'s default 5 s same-origin grouping therefore merges
  all local edits in that window into ONE undo step: type a line, Tab-indent 1 s
  later, one Ctrl+Z reverts both. Found while shipping item 13 (the e2e undo test
  wiped the whole note). The format commands already avoid it via `stopCapturing()`.
- Scope: apply the same `stopCapturing()` pattern (a shared keymap wrapper is the
  DRY option) to `cm-indent.ts`, `cm-table.ts` and `cm-input-rules.ts` so each
  keymap command is its own undo step.
- done-when: e2e "type, indent, Ctrl+Z → only the indent reverts" passes; full
  suite green.

### 12. Follow-up: Mod+N (new session) is likely a dead binding in real browsers

- Evidence: the app's Mod+N new-session shortcut (`AppHeader.svelte`) works in
  e2e (CDP key dispatch delivers Ctrl+N to the page in headless — probed in
  iteration 8), but Ctrl/Cmd+N is a browser-reserved "new window" chord on
  Chrome/Firefox/Safari: in a real browser the browser consumes it before the
  page, so the shortcut likely never fires for real users. Same class of bug as
  the item-7 Mod-Shift+N proposal.
- Scope: rebind new-session to an unreserved chord (candidate: Mod+Alt+S) in
  `AppHeader.svelte`, update the e2e shortcut test, keep the menu entry.
- done-when: e2e passes with the new chord and the old chord is no longer
  bound. (Real-browser verification of the old chord is not possible from this
  loop — the choice is based on the browsers' reserved-shortcut lists.)

### 11. Chore: remove dead editor API

- Evidence: `insertAtCursor` and `focus` are exported from `Editor.svelte` but unused
  anywhere (grep over `src/`).
- done-when: removed; `pnpm check` green.

## Chord reservation audit (2026-08-21, run 2, iteration 1)

Mandate: every chord must be free on Chromium, Firefox **and** Safari. CDP key
dispatch cannot verify this (it bypasses the browser accelerator layer — see
Parked), so this is a desk audit against the three browsers' published
reserved-shortcut lists. Mod = Ctrl (Win/Linux) / Cmd (macOS).

| Chord                | Chromium                     | Firefox                  | Safari (macOS)                        | Decision                                              |
| -------------------- | ---------------------------- | ------------------------ | ------------------------------------- | ----------------------------------------------------- |
| Mod+B                | free                         | free                     | free                                  | **bold**                                              |
| Mod+I                | free                         | free                     | free                                  | **italic**                                            |
| Mod+K                | free                         | free                     | free                                  | **link**                                              |
| Mod+Shift+X          | free                         | free                     | **reserved** (close tab + all right)  | rejected                                              |
| Mod+Alt+X            | free                         | free                     | free                                  | **strikethrough** (substitution for Mod+Shift+X)      |
| Mod+` (backquote)    | free (Win/Linux)             | free                     | **reserved at OS level** (Cmd+\` = app switch) | rejected                                     |
| Mod+Alt+C            | free                         | free                     | free                                  | **inline code** (substitution; "C for code")          |
| Mod+1..6             | **reserved** (switch to tab 1..6) | **reserved** (tab switching) | **reserved** (Cmd+1..8 tab switch) | rejected                                            |
| Mod+0                | **reserved** (reset zoom)    | **reserved** (reset zoom) | **reserved** (reset zoom)             | rejected                                              |
| Mod+Alt+1..6         | free                         | free                     | free                                  | **heading 1..6** (substitution for Mod+1..6)          |
| Mod+Alt+0            | free                         | free                     | free                                  | **remove heading** (substitution for Mod+0)           |
| Mod+Alt+S            | free                         | free                     | free                                  | reserved candidate for item 12 (new session)          |

Notes: the substitutions follow the Mod+Alt pattern this app already established for
the rejected Mod+Shift+N / Mod+Shift+P (items 7, 8), keeping all substituted chords in
one family. Mod+Alt+1..6/0 must be matched via `e.code` (`Digit1`..`Digit6`, `Digit0`)
on macOS (Option alters `e.key`) exactly like the existing Mod+Alt+N/P handlers.
Ctrl+Alt+digit has no known collision with IME or screen-reader modifiers on the three
platforms (NVDA/JAWS use different modifiers).

## Parked (noticed, not yet scoped)

- **CM6 arrow keys collapse before moving (run 2, iteration 1):** with a non-empty
  selection, `ArrowDown`/`ArrowUp` (`cursorByLine` in `@codemirror/commands`)
  collapse the selection to its end/start instead of moving — e2e tests that wrap a
  selection (which leaves it selected) must collapse first (e.g. `End`) before the
  vertical move registers.
- **y-codemirror single Yjs origin (run 2, iteration 1):** see item 18. Practical
  consequence for any future keymap command: wrap the dispatch in
  `undoManager.stopCapturing()` calls or the command will merge with adjacent typing
  into one undo step. `Y.UndoManager` default `timeout` is 5000 ms.
- **lezer bold node names (run 2, iteration 1):** `**bold**` parses as
  `StrongEmphasis` with `EmphasisMark` children — NOT `Strong`/`StrongMark` as in
  CommonMark. `cm-conceal.ts`'s `EmphasisMark` entry therefore covers both italic
  and bold marks (no change needed); any future "is this bold?" logic must match
  `StrongEmphasis`, and grep-based audits for `Strong` will false-negative.
- **e2e suite is flaky on a 24-core box with a reused/stale API (iteration 9):** the
  local machine has 24 cores, so Playwright defaults to 12 concurrent workers; ~16 tests
  share a session (each a `POST /notes` + `PUT` snapshot + WS, some opening a 2nd viewer
  context) and together they exceed the API's per-IP abuse limits (`RATE_CREATE_PER_MIN=10`,
  `MAX_WS_PER_IP=10`), so a random share test 429s and its share link/viewer never appears
  (a 10s timeout). Two compounding traps made this look like a real regression: (a)
  `reuseExistingServer: !CI` means the API process — and its in-memory rate-limit buckets —
  persists across `npx playwright test` invocations, so back-to-back runs fail more as the
  buckets stay drained; (b) manually starting a preview/API that then lingers makes `vite
  preview` pick a different port ("Port 4173 is in use… 4174") while Playwright still waits
  on 4173, so editor-only tests hang at the 30s test timeout. **Recipe for a green local run:**
  kill any stale `mynotes-api` / `vite preview` procs and confirm ports 3000/4173 are free,
  then run `npx playwright test --config playwright.config.ts --workers=2` (Playwright starts
  fresh servers). Verified 3× green this way (66 passed). CI is unaffected — GitHub runners
  have few cores → few workers → low concurrency. Not committed as a config change (kept the
  diff to the feature); revisit if a future iteration needs a stable default.
- **CDP key dispatch bypasses browser accelerator handling (iteration 8):** in
  headless Playwright Chromium every chord reaches the page — Ctrl+N and
  Ctrl+Shift+N (both reserved in real browsers) as well as Ctrl+Alt+N. So e2e
  shortcut tests prove the page handler fires, never that the chord is
  reachable in a real browser. Pick shortcut chords from the unreserved set
  (avoid Ctrl/Cmd+N, Ctrl/Cmd+Shift+N, Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Q,
  F5, Ctrl+R, Ctrl+P, Ctrl+Shift+I, …) and verify the final choice by hand in
  a real browser.
- **`editorText` helper quirk (iteration 8):** on an empty note the `.cm-line`
  `textContent` contains the "Start typing…" placeholder (CM6 renders the
  placeholder inside the line), so `editorText(page)` is not `''` for an empty
  document — assert emptiness by typing into the note or by targeting
  `.cm-placeholder` instead.
- **SvelteKit `goto()` URL timing (iteration 8):** client-side navigation
  updates the URL only after the navigation completes (~300 ms observed,
  includes an IndexedDB write in this app), so shortcut/navigation e2e tests
  must `expect.poll` the URL rather than reading `page.url()` right after the
  keypress (a weak `toHaveURL(/\/s\/[\w-]+/)` assertion passes on the *old*
  URL and masks the race).

- **CM6 decoration wiring (iteration 7):** a `StateField<DecorationSet>` is NOT
  auto-applied by the view — the view only reads the `EditorView.decorations` facet.
  You must add `EditorView.decorations.of(fn)` where `fn` is called with the **view**,
  not the state (`(view) => view.state.field(myField)` — a `(state) =>` signature
  crashes the editor with `d.field is not a function` at init). ViewPlugins with a
  `decorations:` spec (like `concealMarks`) are the other way in.
- **CM6 tree timing (iteration 7):** `syntaxTree(state)` does NOT force a parse — it
  returns the language state's current tree (possibly `Tree.empty`). Small docs parse
  synchronously inside the same transaction (`LanguageState.apply` runs a 20 ms
  `Work.Apply` budget), so a StateField recomputing on `docChanged` sees a complete
  tree; for docs large enough for background parsing, prefer a ViewPlugin that
  reacts to tree updates.
- **RangeSet/RangeCursor (iteration 7):** `RangeSet.iter()` cursors start pointing AT
  the first range (not ES6-iterator semantics) and expose `value` (`null` at the end),
  `from`, `to` — there is no `done` property and no `Symbol.iterator`.
- **marked v18 lexer (iteration 7):** blank lines (incl. leading ones) emit top-level
  `space` tokens — "first block" logic must skip them (a leading blank line renders as
  no HTML). `marked.parser(tokens)` accepts a token subset, and parser output ends
  with a trailing `\n`.
- **DOMPurify under vitest (iteration 7):** the module is inert in node, so a
  module-level `DOMPurify.addHook` throws at import time in unit tests; guard with
  `DOMPurify.isSupported` (behavior-neutral: the app sets `ssr = false`, so the
  browser always supports it).
- **Seed-idea input rules (iteration 7):** the seed's `# ` → heading / `> ` → quote
  input rules look mostly redundant — lezer live-styles `# `/`>` prefixes as they're
  typed, and `markdownKeymap` already continues quotes/lists on Enter. No separate
   backlog item created; revisit only if real typing friction is observed.
- **CM6 touch mechanics (iteration 6):** `domEventHandlers` listeners attach to
  `.cm-content` and are added with `{ passive: !handlers[type].handlers.length }` —
  registering any handler for an event type makes it non-passive, so `preventDefault`
  works. A handler returning `true` makes CM6 call `event.preventDefault()` itself, and
  handlers are skipped once `event.defaultPrevented` is set. CM6's own touch handling is
  observers-only (no interference), and its `mousedown` handler ignores mousedowns within
  2000 ms of the last touch — cursor placement after a real tap is the browser's native
  contenteditable selection, not CM6.
- **Playwright touch synthesis (iteration 6):** no long-press API exists; dispatch
  `TouchEvent`s with `new Touch({ identifier, target, clientX, … })` built in
  `page.evaluate` (cast the init `as unknown as TouchEventInit` — `Touch[]` is not
  assignable to `TouchList` in TS). `element.dispatchEvent` returns `false` when any
  handler called `preventDefault` — use that return value to assert the
  consume/suppress contract of touch handlers.

- **CM6 gotcha (iteration 5):** `Tree.iterate({ enter(node) })` passes a **TreeCursor**,
  not a SyntaxNode — `node.parent` is a *method* (so `node.parent?.name` is the string
  `'parent'`, silently wrong). To walk ancestors, use `tree.resolveInner(pos, side)`
  (returns a real SyntaxNode with a `.parent` property). Also, `resolveInner(pos, -1)`
  at position 0 resolves to `Document` (nothing precedes it) — use side `+1` when the
  node starts at the position.
- **CM6 gotcha (iteration 5):** `inputRules` is CodeMirror 5 — no CM6 package exports it.
  Input-time behavior belongs in keymap bindings (`key: 'Enter'`, `key: ']'`) or view
  plugins; a keymap `run` returning true also suppresses the typed character, so the
  binding must insert it itself (e.g. `]` pairing inserts `]()`, not just `()`).
- **Table alignment plumbing (iteration 12):** `marked` v18 renders GFM column alignment
  as the deprecated `align="left|center|right"` **attribute** (not an inline style);
  DOMPurify's default `html` attribute allow list includes `align`, so it survives
  sanitization untouched, and Chromium applies the attribute to layout. Two computed-style
  gotchas when asserting on it in e2e: (a) Chromium reports attribute-derived
  `text-align` as `-webkit-left` / `-webkit-center` / `-webkit-right` (CSS-derived values
  come back plain), so normalize with `.replace(/^-webkit-/, '')`; (b) the UA default for
  an unaligned `td` is the logical value `start` (not `left`) in current Chromium, while
  an unaligned `th` is `center`. Also: `renderMarkdown` is not unit-testable in node — the
  `dompurify` default export outside a browser is a factory function with `isSupported:
  false` and no `sanitize`, so unit tests must target `titleWrappedHtml` (pre-sanitize
  marked output) and leave the sanitize step to e2e.
- **Audit gotcha (iteration 3):** `@codemirror/lang-markdown`'s dist does not
  contain the GFM node names (Strikethrough, Subscript, …) — they come from the
  transitive `@lezer/markdown` package. Grep the whole `node_modules/.pnpm` tree
  (or parse a probe document and print tree node names) before concluding a
  markdown construct is unparsed; the iteration-1 "no StrikethroughMark" finding
  was such a false negative.
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
