# UX Backlog

Plan of record for the overnight UX loop. Take the top unblocked item, implement the
smallest useful slice with tests, verify (`pnpm lint && pnpm check && pnpm test`, plus
`pnpm screenshots` for any visible UI change), mark it done with one line of evidence,
and re-prioritize. Open items are listed by priority (numbering is stable across runs;
done items are kept in place as the audit trail).

## Status (2026-08-21, run 3, iteration 8)

- Iteration 8 shipped item 30 — Mod+Alt+L now INSERTS the `[ ] ` marker in
  the two GFM task forms item 28 could only strip: ordered (`1. x` →
  `1. [ ] x`, all of `1.` / `1)` / nested) and blockquoted bullet
  (`> - x` → `> - [ ] x`, incl. `> >` and the no-space `>-` quote form) —
  plus a deliberate scope extension of the seeded direction: the ordered
  branch takes a quote prefix, so `> 1. x` → `> 1. [ ] x` too, the exact
  inverse of item 28's quoted-ordered strip (keeps Mod+Alt+L a true toggle
  in every form the strip covers). Plain quoted lines (`> note`) stay a
  no-op, as in code, tables, setext pairs, and thematic breaks. New pure
  `taskInsertLine(line)` + an `insertable` parameter on `taskBlocked`
  (the `OrderedList` / `Blockquote` ancestor block now applies only to
  marker-less, non-insertable lines). Caret mapping in `applyTaskToggle`
  refined to insert-point-aware (a caret parked before the marker no longer
  jumps into the inserted `[ ] `). 32 unit tests + 4 sensitivity-verified
  e2e (insert with the preview checkbox count 0→1 in both forms, a `1)`
  insert/strip round trip, own undo step). Full suite green: 470 unit +
  155 e2e (5 pre-existing skips). No new chord. No screenshot impact:
  keymap-only, fixtures contain no ordered/blockquoted task lists (docker
  still unavailable in this env — see Parked). Next unblocked: item 31
  (Backspace on an empty ordered task does not exit the list).

- Iteration 7 shipped item 29 — Enter-continuation on ordered task items now
  keeps the `[ ] ` marker (`1. [ ] x` + Enter → `1. [ ] x\n2. [ ] `), and an
  empty ordered task exits the list exactly like a bullet (single empty item →
  plain line; tight second item → blank line first, then exit). New
  `src/lib/cm-task-newline.ts`: a pure `orderedTaskNewlineChanges(state)` +
  `Enter` keymap command wired in `Editor.svelte` at `Prec.highest` (ahead of
  `markdownKeymap`'s `Prec.high` Enter). Two paths, both reusing the upstream
  `insertNewlineContinueMarkup` via a captured dispatch: (a) ordered task WITH
  content (tree `TaskMarker` whose innermost list is `OrderedList`) — the
  built-in runs, then a composed `ChangeSet` patch splices `[ ] ` right after
  the fresh `N.`/`N)` marker (quote prefixes and nested indents handled; a
  mid-line split puts the marker before the remainder); (b) EMPTY ordered task
  (marker present or not — probe: `1. [ ] ` parses WITH a `TaskMarker`,
  `1. [ ]` as a marker-less `Paragraph`) — the bare `[x]` token is deleted
  first (composed locally), then the built-in runs on the stripped state, so
  ITS OWN empty-item logic (exit / tight→loose / renumber / quote handling)
  executes on a plain empty ordered item — bullet semantics with zero
  duplication of upstream code. Bullet tasks (incl. nested in ordered), plain
  ordered lines, fences, and non-list lines all fall through to the built-in
  unchanged. 18 unit tests (`cm-task-newline.test.ts`) + 4 e2e
  (`e2e/task-lists.spec.ts`: continuation with the preview checkbox count
  1→2, empty exit, the tight-list Enter ladder, own undo step) — all 4
  sensitivity-verified (each fails with the keymap wiring removed). Full suite
  green: 438 unit + 152 e2e (5 pre-existing skips). No new chord (Enter). No
  screenshot impact: fixtures never press Enter on an ordered task list
  (docker still unavailable in this env — see Parked). Re-audit seeded item 30
  (Mod+Alt+L insert direction for ordered/blockquoted tasks — the one form the
  toggle still cannot make) and item 31 (Backspace on an empty ordered task
  does not exit the list — probe-verified bullet asymmetry). Next unblocked:
  item 30.

- Iteration 6 shipped item 28 — the Mod+Alt+L task toggle now also strips the
  marker from the two remaining GFM task forms: ordered (`1. [ ] x` → `1. x`,
  all of `1.` / `1)` / nested) and blockquoted (`> - [ ] x` → `> - x`, incl.
  `> >` and `> 1.` nesting). `taskBlocked` splits its ancestor set: the hard
  blocks (FencedCode / CodeBlock / Table / SetextHeading1-2 / HorizontalRule)
  always no-op, while `OrderedList` / `Blockquote` are now blocked **only when
  the line has no `TaskMarker`** (the command computes the marker first and
  passes it in). So a task line inside those forms takes the existing
  tree-marker strip branch (which already computed the right change — probe
  verified lezer emits `Task` / `TaskMarker` for every ordered and blockquoted
  form), while a plain `1. x` / `> note` line still no-ops. Deliberate v1
  decision: strip-only for both forms — the *insert* direction (`1. x` →
  `1. [ ] x`, `> - x` → `> - [ ] x`) is a second regex branch each and is
  deferred (seeded as item 29); the preview checkbox (item 17c) already toggles
  every form, so "make it a task" stays reachable. 16 unit tests
  (`cm-task-toggle.test.ts`: marker-strip for dot/paren/nested ordered and
  quoted/bullet/deep-nested/quoted-ordered, plus `taskBlocked` allow-with-
  marker / block-without for each) + 4 e2e (`e2e/task-lists.spec.ts`: ordered
  strip with the preview checkbox count 1→0, blockquoted strip 1→0, plain
  ordered no-op, plain blockquote no-op) — the two strip e2e are
  sensitivity-verified (both fail with the old always-block `taskBlocked`).
  Full suite green: 420 unit + 148 e2e (5 pre-existing skips). No screenshot
  impact: keymap-only, fixtures contain no ordered/blockquoted tasks and never
  press the new path (docker still unavailable in this env — see Parked).
  Re-audit seeded item 29 (ordered task continuation drops the `[ ] ` marker —
  probe-verified upstream gap in `@codemirror/lang-markdown` `getContext`) as
  the next unblocked item. Next unblocked: item 29.

- Iteration 5 shipped item 27 — the task-toggle keyboard command
  (Mod+Alt+L): `src/lib/cm-task-toggle.ts` adds `taskBlocked` (syntax-tree
  ancestor walk over FencedCode / CodeBlock / Table / OrderedList /
  SetextHeading1/2 / HorizontalRule / Blockquote — top-level lines only),
  `taskMarkerOnLine` (line-range `TaskMarker` probe, the 17a/17b precedent),
  pure `applyTaskToggle({ doc, from, to, marker })` and
  `taskToggleCommand`/`taskToggleKeymap` (one `Mod-Alt-l` binding, routed
  through `ownUndoStep`), wired in `Editor.svelte` after `formatKeymap`.
  Semantics: a line with a tree `TaskMarker` → strip the marker + its
  trailing separator; else a task line (regex — covers the bare `- [x]` /
  `- [ ]` forms the tree parses as Link/Paragraph without a marker) →
  strip; else a bullet line `(\s*)([-*+])␣…` → insert `[ ] ` after the
  bullet; else prefix `- [ ] ` at column 0 (an empty line yields `- [ ] `
  WITH a trailing space, unlike item 15's bare `##`, so the next typed
  character already forms a valid GFM task). 50 unit tests
  (`cm-task-toggle.test.ts`: all transformation branches + the regex
  fallbacks + `taskMarkerOnLine` + `taskBlocked`) + 4 e2e
  (`e2e/task-lists.spec.ts`: plain line → task with the interactive preview
  checkbox appearing on `data-task-line=1`; task → plain bullet → task
  round trip; own undo step; read-only shared view no-op) — the three
  behavioral e2e are sensitivity-verified (each fails without the keymap
  wiring; the read-only one locks the editable guard). Full suite green:
  404 unit + 144 e2e (5 pre-existing skips). No screenshot impact:
  keymap-only change, the fixtures contain no task lists and never press
  the new chord (docker still unavailable in this env — see Parked).
  Re-audit seeded item 28 (extend the keyboard toggle to ordered and
  blockquote tasks — probe-verified: lezer DOES emit `Task`/`TaskMarker`
  for both forms, so item 27's strip branch already works for them once
  the `OrderedList`/`Blockquote` ancestor block is lifted) as the next
  unblocked item. Next unblocked: item 28.

- Iteration 4 shipped item 25 — the per-note work position now persists
  across reloads: a new `selections` object store (IDB v3) holds
  `{ anchor, head }` per note, written by `src/lib/selection-persist.ts`
  (single debounced pending slot, 500 ms; flushed on
  `visibilitychange: hidden` / `pagehide`) from the Editor's
  on-every-update path; on mount the editor prefers the in-tab
  `selection-memory` and falls back to a guarded async read (skipped if
  the doc changed or the selection moved since mount; clamped;
  `scrollIntoView` so item 26's scroll applies for free). Deliberate
  deviation from the seeded direction: a separate store instead of a
  field on the `Note` record — a read-modify-write from the persist path
  would race `syncMetadata`'s content write (stale `content` put back
  over a fresher one). 18 unit tests (6 db / 6 selection-memory / 6
  selection-persist) + 2 e2e (`e2e/selection-persist.spec.ts`), both
  halves sensitivity-verified (write side off → `**hello** world` +
  `scrollTop = 0`; restore dispatch off → the backward-selection test
  fails). Full suite green: 354 unit + 140 e2e (5 pre-existing skips).
  No screenshot impact: no fixture reloads, parks a deep caret, or
  changes content (docker still unavailable in this env — see Parked).
  Re-audit seeded item 27 (task-toggle keyboard command — the keyboard
  half of the item-17 task-list input trio) as the next unblocked item.
  Next unblocked: item 27.

- Iteration 3 shipped item 26 — the remounted editor now scrolls the
  viewport to the restored caret/selection: `Editor.svelte` onMount
  dispatches the seeded main selection with `scrollIntoView: true` when
  it is a non-default position (selection-only transaction — no Yjs step,
  no undo-clock reset). 3 e2e tests (`e2e/scroll-restore.spec.ts`), all
  sensitivity-verified: 40-line note + `Control+End` + A→B→A →
  `scrollTop > 0` and a typed char lands on line 40 (fails without the
  dispatch); a 5-line note that fits the viewport stays at `scrollTop =
  0`; preview toggle round trip also restores the scroll. Full suite
  green: 336 unit + 138 e2e (5 pre-existing skips). No screenshot impact:
  no visible change in the committed fixtures (they are shorter than one
  viewport and never park a deep caret before switching — see Parked for
  the CM6 `.cm-gap` culling gotcha that shaped the test assertions).
  Next unblocked: item 25 (persist the per-note position across reloads).

- Iteration 2 shipped item 24 — per-note SELECTION restoration on note
  switch: `caret-memory.ts` is now `selection-memory.ts` and records the
  full `{ anchor, head }` per note (same per-tab map, same on-every-update
  recording); `Editor.svelte` seeds the remounted EditorState with the
  restored range — an empty range is a caret point, backward selections
  are preserved, both ends are independently clamped into `0..docLength`.
  14 unit tests (`selection-memory.test.ts`) + 1 sensitivity-verified e2e
  (`e2e/selection-memory.spec.ts`, renamed from `caret-memory.spec.ts`):
  select the whole of `hello world` with Shift+arrows (backward
  selection), A→B→A, Mod+B wraps exactly the restored range to `**hello
  world**` — under caret-only restoration the same press wraps only
  `hello` (`**hello** world`), so the test locks the fix. The item-20
  caret tests are unchanged and green. Full suite green: 336 unit +
  135 e2e (5 pre-existing skips). No screenshot impact: no fixture
  switches notes with a pending selection and the fixtures pass
  `caret: 'hide'` (docker still unavailable in this env — see Parked).
  Re-audit seeded item 26 (scroll the viewport to the restored position
  on remount — gap verified by probe: a remounted 40-line note with the
  saved caret on the last line reports `scrollTop = 0`) and item 25
  (persist the per-note position across reloads via the local note
  metadata — item 20's explicit in-memory boundary). Next unblocked:
  item 26.

- Iteration 1 shipped item 21 — per-note undo history across note switches
  (per-tab `WeakMap<Y.Text, Y.UndoManager>` reused across mounts), plus item 22 —
  the redo chord fix found while locking item 21's redo side: y-codemirror's
  `Mod-Shift-z` binding can never match a real Ctrl/Cmd+Shift+Z keypress (CM6
  key-name case mismatch), so `Editor.svelte` now binds `Mod-Shift-Z`
  (uppercase) to the shared manager's redo. 8 unit tests
  (`undo-memory.test.ts`) + 4 sensitivity-verified e2e tests
  (`e2e/undo-memory.spec.ts`) incl. a faithful real-browser-key-casing probe.
  Full suite green twice: 331 unit + 134 e2e (5 pre-existing skips). No
  screenshot impact: no visible change, fixtures never press the affected
  chords (docker still unavailable in this env — see Parked). Re-audit
  seeded item 23 (typewriter scrolling — blocked on a product decision)
  and item 24 (per-note SELECTION restoration, item 20's explicit
  caret-only boundary) — next unblocked: item 24.

- Iteration 12 (run 2) shipped item 20 — per-note caret restoration. New
  `src/lib/caret-memory.ts` (per-tab `Map<noteId, number>`) records the
  caret head on every editor update and restores it as the initial
  selection on remount, clamped to the current doc length. `Editor.svelte`
  takes a `noteId` prop; both routes pass it and `forgetCaret` on note
  delete. 9 unit tests (`caret-memory.test.ts`) + 2 e2e tests
  (`e2e/caret-memory.spec.ts`): mid-line A→B→A restore (a typed char lands
  at the saved position, not 0) and a clamp verified through a LIVE edit
  collaborator (fresh context + edit link over the server relay) who
  shrinks the note from 11 to 2 chars while the owner is on another note —
  the owner's return lands the caret at the end. The autofocus spec's
  note-switch expectation was tightened from
  `['!alpha note', 'alpha note!']` to exactly `'alpha note!'` (the
  iteration-11 hand-off, now consumed). Full suite green twice: 323 unit +
  130 e2e (5 pre-existing skips). No screenshot impact: caret position is
  not asserted by any fixture (docker still unavailable in this env — see
  Parked). Next unblocked: item 21 (per-note undo history across note
  switches).

- Former item 10 (images) is **CLOSED by product decision** — pruned per the mandate.
  The record is `docs/adr/0001-documents-stay-pure-markdown.md`; no image/blob work may
  be re-added without explicitly re-opening that ADR.
- Seeded the agreed writing-experience feature set as items 13–17 (per-iteration slices
  with done-when lines) and re-prioritized: formatting first (most frequent writing
  action), then headings, links, task lists. Item 18 (undo granularity) was added the
  same day — a gap found while implementing item 13 — and shipped in iteration 8.
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
- Shortcuts: Mod+Alt+S new session, Mod+E export, Mod+O sidebar, Mod+Alt+N new note,
  Mod+Alt+P preview toggle (see items 7, 8 and 12 — the Alt chords were chosen because
  the original Mod-Shift+N / Mod-Shift-P proposals, and the Mod+N new-session chord,
  are browser-reserved)
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

### 14. DONE (2026-08-21): Formatting commands: Mod+Alt+X strikethrough, Mod+Alt+C inline code

- Evidence: `formatKeymap` in `src/lib/cm-format.ts` gained `Mod-Alt-x` → `~~` and
  `Mod-Alt-c` → `` ` `` on item 13's mark-agnostic engine (no engine change); 16 unit
  tests (`cm-format.test.ts`, both marks across selection/word/empty/unwrap cases incl.
  backtick-as-word-boundary) + 5 e2e tests (`e2e/formatting.spec.ts`: word wrap + toggle
  per chord, selection wrap per chord, concealment of both mark types on inactive lines
  with document unchanged). Full suite green: 204 unit + 88 e2e (5 pre-existing skips).
- Concealment: verified `cm-conceal.ts` already conceals `StrikethroughMark` and
  `CodeMark` (grammar premises pinned in `cm-conceal.test.ts`) — no concealment change
  needed, e2e locks it.
- Key parsing: verified in `@codemirror/view`'s `normalizeKeyName` that `Mod-Alt-x`
  normalizes to `Ctrl-Alt-x` (Win/Linux) / `Alt-Meta-x` (mac), and CM6's keyCode-based
  fallback (`w3c-keyname` + `base[]` table) resolves macOS Option-mangled `e.key`
  (e.g. `∩`) back to the chord — unlike the raw DOM handlers in `AppHeader.svelte`, CM6
  keymap bindings need no `e.code` workaround for Option chords.
- Screenshots: keymap-only change, fixtures never press the new chords — committed PNGs
  cannot change; no regeneration needed (docker still unavailable here, see Parked).

### 15. DONE (2026-08-21): Heading toggles — Mod+Alt+1..6 set the line's level, Mod+Alt+0 removes it

- Evidence: `applyHeading` (pure) + `headingBlocked` (syntax-tree guard) +
  `headingCommand(level, undoManager)` in `src/lib/cm-format.ts`, plus 7 new
  `formatKeymap` bindings (`Mod-Alt-1..6` / `Mod-Alt-0`), already wired in
  `Editor.svelte`. 20 unit tests (`cm-format.test.ts`: set/overwrite/remove,
  cursor + selection shifting, empty line / empty heading, `#######` and `#nospace`
  not treated as headings, table / indented-code / setext no-ops) + 8 e2e tests
  (`e2e/headings.spec.ts`: set, overwrite, remove, concealment invariant on the
  `#` mark, fenced-code no-op, table-row no-op, own-undo-step, read-only no-op).
  Full suite green: 232 unit + 96 e2e (5 pre-existing skips).
- Semantics: acts on the cursor's line only. An existing ATX prefix
  (`^ {0,3}#{1,6}` + space) is replaced with `#`×level + one space (extra spaces
  collapsed); level 0 strips the prefix; a plain line gets the prefix inserted at
  column 0; an empty line gets a bare `#`×level (no trailing space). The cursor /
  single-line selection shifts with the content. No-op: multi-line selection,
  fenced code, indented `CodeBlock`, table rows, and setext (see below).
- Tree guard (`headingBlocked`): resolves the line's first non-space char and walks
  up for `FencedCode` / `CodeBlock` / `Table`. GFM gotcha pinned by a unit test: a
  pipe-less line *directly* under a table (no blank line) parses as a table row, so
  it is blocked too — a blank line is required for the line to be free.
- Setext headings: ATX-only for v1, per scope. The command no-ops both on the
  underline line and on the paragraph line directly above a `=`/`-` underline,
  rather than converting setext→ATX (documented in Parked).
- Screenshots: keymap-only change; the committed fixture never presses the new
  chords and headings already render styled, so no PNG can change (docker still
  unavailable in this env — see Parked).

### 16. DONE (2026-08-21): Link command — Mod+K

- Evidence: `pasteURLAsLink` (built into `markdown()`, default on) already turns a
  pasted URL over a selection into `[selection](pasted-url)` — the paste path is
  live and documented here; Mod+K is the deliberate keyboard counterpart.
  `linkCommand()` + pure `applyLink()` + tree probes `linkProbe()`/`overlappingLink()`
  in `src/lib/cm-format.ts`, `Mod-k` binding in `formatKeymap` (already wired in
  `Editor.svelte`). 34 unit tests (`cm-format.test.ts`: wrap/word/pair/unwrap range
  math, `[ ] ( )` as word boundaries, `clipboardUrl` validation, probe hit/miss
  incl. boundaries and images) + 8 e2e tests (`e2e/link.spec.ts`: selection +
  clipboard-URL auto-fill with toggle-off, no-URL empty parens with cursor verified
  by typing, word label, bare `[]()`, unwrap from inside a link, concealment of
  `[ ]()` marks on inactive lines, own-undo-step, read-only shared-session no-op).
  Full suite green: 260 unit + 104 e2e (5 pre-existing skips).
- Semantics: selection → `[sel](url)`; no selection, cursor on a word → `[word]()`,
  cursor inside `()`; no word → `[]()`, cursor inside `[]`. Toggle: cursor or
  selection strictly inside a `Link` node → unwrap to the label (label stays
  selected, so a third press re-wraps). Cursor/selection inside an `Image` node, a
  selection crossing a link/image boundary, or fenced code → no-op.
- Clipboard: `navigator.clipboard.readText()` is async, so the wrap dispatches
  immediately with `()` and the url is filled by a guarded follow-up dispatch
  (only if the cursor is still between `](` and `)` with nothing in between).
  Validation: absolute URL (`^[a-z][a-z\d+.-]*:\/\/\S+$`) after trim; anything else
  (incl. `www.…` and `javascript:`) is ignored. Because the fill is a separate
  transaction, a clipboard-filled link is TWO undo steps (wrap, then url) —
  accepted: same-origin grouping can't be used safely across the async gap (see
  item 18).
- Word bounds for links exclude `[ ] ( )` (so a cursor next to an existing link
  never swallows it into the new label).
- Screenshots: keymap-only change; the committed fixture never presses Mod+K and
  link marks were already concealed, so no PNG can change (docker still
  unavailable in this env — see Parked).

### 17. Task lists (checkboxes)

- Slice (a) — DONE (2026-08-21): verified + regression-locked continuation
  (verification only, no new behavior). Evidence: `src/lib/task-continuation.test.ts`
  (9 unit tests driving `insertNewlineContinueMarkup` through a real state: unchecked
  continuation with the cursor after the marker, checked→unchecked, nested indent kept,
  single empty item exits the list, empty item after a blank line is removed, empty
  item in a tight list takes a blank line first, fenced-code no-continue, plain-bullet
  control) + `e2e/task-lists.spec.ts` (5 tests: continue + type into the new task,
  checked→unchecked, empty-item exit, the tight→loose→exit Enter ladder, fenced-code
  no-continue). Full suite green: 269 unit + 109 e2e (5 pre-existing skips).
  Exit nuance (locked, and relevant to slice c): Enter on an empty task item removes
  the marker only when it is the first item or a blank line precedes it; the empty
  *second* item of a tight list first inserts a blank line (tight→loose), so exiting
  can take two Enters.
- Slice (b) — DONE (2026-08-21): editor bracket-click toggle. Evidence:
  `src/lib/cm-task-click.ts` — `taskMarkerAt` (line-bounded `TaskMarker` tree
  probe) + pure `toggleMarkerChange` + `taskMarkerClick` (`domEventHandlers`
  click), wired in `Editor.svelte` after `clickableLinks` — with 17 unit tests
  (`cm-task-click.test.ts`: token-range computation incl. both boundaries,
  indented / multi-line / right-line-of-two markers, no-trailing-space and
  invalid-middle-char lines not toggleable, fenced code no-op) + 5 e2e tests
  (`e2e/task-lists.spec.ts`: toggle on→off round trip, word click does not
  toggle and places the caret (verified by typing into the word), nested item
  toggles only itself, own undo step, read-only shared-view no-op). Full suite
  green: 286 unit + 114 e2e (5 pre-existing skips).
  Semantics: an unmodified click whose `posAtCoords` position falls within the
  `TaskMarker` range (inclusive both ends = the whole 3-char token) flips the
  middle char (` ` ↔ `x`; `[X]` unchecks) as a single one-char dispatch with
  `stopCapturing` undo isolation, and consumes the click (caret stays at the
  click point). Modified clicks (ctrl/meta = link open, shift/alt = selection)
  and read-only views fall through to default behavior.
  **Premise correction** (locked by unit tests): the toggleable char is at
  `TaskMarker.from + 1` (the middle of the 3-char token), NOT `from + 2` as the
  slice-(a) premise said. Also locked: `- [x]` with no trailing content parses
  as a `Link` and bare `- [ ]` as a `Paragraph` — neither has a `TaskMarker`, so
  neither is toggleable.
  Screenshots: click-handler-only change; the committed fixture contains no
  task list and never clicks a marker, so no PNG can change (docker still
  unavailable in this env — see Parked).
- Slice (c) — DONE (2026-08-21): preview checkboxes. Evidence:
  `src/lib/task-lines.ts` — pure `scanTaskLines(content)` line-based GFM
  task scanner (fence / top-level + nested indented-code / blockquote /
  list-item state machine; mirrors marked's `listIsTask`
  `/^\[[ xX]\] +\S/` semantics incl. tab expansion and the
  trailing-space + content requirements) returning
  `{ line, checked, markerStart }` in document order — cross-validated
  against marked's real task detection on 30 fixture documents (count +
  state, all match); `markdown.ts` — `renderMarkdown(content, readOnly = true)`
  / `titleWrappedHtml(content, readOnly = true)` build a full `marked`
  `Renderer` whose `checkbox` override (marked v18 renders task items via a
  dedicated `checkbox` token/renderer) emits
  `<input type="checkbox" tabindex="-1" data-task-line={n} [checked]>` for
  writable views, pairing the i-th checkbox with the i-th scanner candidate
  guarded by a checked-state match (any divergence falls back to marked's
  default disabled checkbox — never a wrong line); `s/[id]/+page.svelte` —
  delegated click listener on the preview article (attached via `bind:this` +
  `$effect` addEventListener to keep svelte-check a11y-warning-free),
  `toggleTaskLine` re-scans the CURRENT document, requires the line AND the
  expected pre-click state to match, and applies one `doc.transact`
  delete+insert (null origin — same as y-codemirror's local edits, so the
  toggle stays undoable by mounted collaborators); `app.css` —
  `.preview input[data-task-line] { cursor: pointer; accent-color:
  var(--accent) }`. 16 unit tests (`task-lines.test.ts`: flat/nested/ordered/
  blockquote/loose, fence + top-level + nested-code exclusion,
  no-content / no-trailing-space non-tasks, `[X]`, extra bullet-marker
  spaces, marker offsets) + 6 unit tests (`markdown.test.ts`: default
  disabled output, interactive output, nested + fence + title-split line
  numbering, non-task items untouched) + 5 e2e tests
  (`e2e/task-lists.spec.ts`: checkbox click flips the stored line (verified
  via editor state after toggling back), uncheck round trip, nested toggle
  isolation, fenced fake task gets no checkbox, read-only shared view has
  no preview toggle and no interactive checkboxes). Full suite green twice:
  308 unit + 119 e2e.
  Semantics: the pre-click state is read from the `checked` ATTRIBUTE, not
  the `checked` property — browsers natively toggle the property on
  mousedown (before the click event), so the property is already post-click
  in the handler and `preventDefault` cannot revert it. `tabindex="-1"`
  keeps the checkbox mouse-only (a native keyboard toggle would desync from
  the document). Read-only shared views: the preview stays disabled (item 8
  / PLAN.md "preview disabled in read-only shares"), which satisfies the
  mandate's "disabled in read-only shared views" — no preview, hence no
  checkboxes; locked by e2e. Screenshots: the committed fixture contains no
  task list and the fixtures never click a checkbox, so no PNG can change
  (docker still unavailable in this env — see Parked).

### 18. DONE (2026-08-21): Undo granularity — every keymap command is its own undo step

- Evidence: new `src/lib/cm-undo.ts` — `ownUndoStep(view, spec, undoManager?)`
  wraps a dispatch in `undoManager.stopCapturing()` before/after, **but only
  when the spec has changes** (a selection-only dispatch must NOT reset Yjs's
  capture clock, or it would split a typing burst that straddles a cursor
  move). `indentKeymap` / `tableKeymap` / `inputRulesKeymap` became factories
  taking the editor's `Y.UndoManager` and route every dispatch through
  `ownUndoStep`; `Editor.svelte` passes the manager in (as it already did for
  `formatKeymap`). Root cause unchanged from when it was found (item 13):
  `y-codemirror.next` 0.3.5 transacts **every** local CM dispatch to the
  `Y.Text` with one origin, and `Y.UndoManager` merges same-origin edits
  within its capture window into ONE undo step.
- Tests: 6 unit tests (`cm-undo.test.ts`, driving a REAL `Y.Doc` +
  `Y.UndoManager` with a y-codemirror-style single tracked origin — command
  isolated from typing on both sides, two consecutive isolated commands,
  selection-only creates no step and does not split a typing burst, plus a
  control test proving an UNisolated dispatch merges with the typing step) +
  5 e2e tests: indent (type+Tab → Ctrl+Z reverts only the Tab; and the
  type/indent/dedent three-step ladder), tables (typed row + Enter → Ctrl+Z
  reverts only the row insert), input rules (fence auto-close, and `[]()`
  bracket pairing, each their own step).
- Sensitivity: with the isolation disabled (`ownUndoStep` reduced to a bare
  `dispatch`), all 5 new e2e tests FAIL (typing + command merge, one Ctrl+Z
  reverts both) — the tests genuinely lock the fix. Full suite green twice:
  314 unit + 124 e2e (5 pre-existing skips).
- Screenshots: keymap-only change; the committed fixtures use `fill()` and
  never press Tab/Enter/`]` in the affected contexts, so no PNG can change
  (docker still unavailable in this env — see Parked).

### 12. DONE (2026-08-21): New session rebound to Mod+Alt+S — Mod+N was a dead binding in real browsers

- Premise (carried from the follow-up): the Mod+N new-session shortcut
  (`AppHeader.svelte`) worked in e2e (CDP key dispatch delivers Ctrl+N to the
  page in headless — probed in iteration 8), but Ctrl/Cmd+N is a
  browser-reserved "new window" chord on Chrome/Firefox/Safari: in a real
  browser the browser consumes it before the page, so it likely never fired for
  real users. Same class of bug as the item-7 Mod-Shift+N proposal.
- Evidence: `AppHeader.svelte`'s keydown now maps `mod + altKey + s` to
  `onMenuAction('newSession')` — matched `e.code === 'KeyS'` on macOS and
  `e.key.toLowerCase() === 's'` elsewhere, so Option-mangled `e.key` on macOS
  and AltGr character typing on European layouts never misfire (same pattern as
  the Mod+Alt+N/P handlers) — and the old `mod + e.key === 'n'` branch is
  REMOVED, so the reserved chord does the browser's thing (open a new window)
  instead of silently stealing it. Mod+Alt+S was already audited free on all
  three browsers (audit table below, now assigned). `e2e/shortcuts.spec.ts`:
  `Ctrl+Alt+S starts a new session` (navigates to a fresh `/s/{id}`) and
  `Ctrl+N no longer starts a new session` (pressing the old chord leaves the
  session URL and editor untouched — sensitivity-verified: it fails if the old
  branch is re-added, since CDP dispatch does deliver Ctrl+N in headless). Full
  suite green twice: 314 unit + 125 e2e (5 pre-existing skips).
- Scope notes: the "New session" menu entry is unchanged; the frozen legacy
  `n/[id]` page's `handleMenuAction` does not handle `newSession`, so the chord
  is a no-op there (as Mod+N was). Read-only shared views behave as before:
  the chord creates a LOCAL session on the viewer's own device (their data,
  zero-knowledge server untouched). Screenshots: keydown-handler-only change,
  fixtures never press the chord — no PNG can change (docker still unavailable
  in this env — see Parked). Real-browser verification of the new chord is not
  possible from this loop — the choice is based on the browsers'
  reserved-shortcut lists (see Parked: CDP bypasses the accelerator layer).

### 11. DONE (2026-08-21, iteration 10): Chore — remove dead editor API

- Evidence: `insertAtCursor` and `focus` removed from `Editor.svelte`; the audit
  extended to the bind chain — both pages kept `let editor = $state<Editor | null>`
  + `bind:this={editor}` solely to call those two exports, and the variable was
  never read (grep `editor\??\.` over `src/` = 0 matches), so the orphaned state
  + bindings were removed from `s/[id]/+page.svelte` and `n/[id]/+page.svelte`
  as part of the same chore. `pnpm lint && pnpm check && pnpm test` green
  (0 errors / 0 warnings, 314 unit). No behavior change → no e2e/screenshot
  impact.

### 19. DONE (2026-08-21, iteration 11): Editor autofocus — typing starts without a click

- Premise (code-verified iteration 10): nothing in `src/` ever focuses the
  editor — no `focus()` call, no `autofocus` attribute. After load (or a note
  switch, which remounts via `{#key noteId}`) `document.activeElement` is
  `<body>`, so the user's first keystroke is silently lost until they click the
  page. That breaks the "one blank page, instant start" north star (Docs /
  Obsidian / Typora all place the caret immediately on open).
- Scope: focus the editor on mount **when it is editable** (covers first load
  and note-switch remounts; a mount-time focus does not steal focus while the
  user is in the sidebar/share panel, because those interactions do not
  remount the editor). Read-only shared views must NOT autofocus (no caret to
  show, and no surprise focus). Mobile consequence (virtual keyboard opens on
  load) is accepted: the user opened a note page to write.
- Evidence: `Editor.svelte`'s `onMount` calls `view.focus()` immediately after
  `new EditorView(...)` when the `editable` prop is true — one line; both
  routes benefit (`n/[id]` passes `editable={data.shared.owner}` on shared
  notes, default `true` otherwise), so read-only shared views never autofocus.
  3 e2e tests (`e2e/autofocus.spec.ts`): (a) zero-click typing right after load
  — verified sensitive, fails with the fix removed; (b) read-only shared view
  keeps `document.activeElement` at `<body>`; (c) refocus across a note switch
  — type in A, new note + type in B (no clicks), back to A + type (no click),
  char verified to land in A — verified sensitive too. Full suite green twice:
  314 unit + 128 e2e (5 pre-existing skips). Screenshots: none regenerated —
  the fixtures' `page.screenshot` calls already pass `caret: 'hide'` +
  `animations: 'disabled'`, so a focused caret cannot change a committed PNG
  (docker still unavailable in this env — see Parked). Note for item 20: the
  note-switch test's final expectation is `'!alpha note'` (caret at 0,
  pre-restoration); it becomes `'alpha note!'` once caret restoration lands.

### 20. DONE (2026-08-21, iteration 12): Restore per-note caret position on note switch

- Evidence: new `src/lib/caret-memory.ts` — a per-tab (module-level)
  `Map<noteId, number>` with `recordCaret(noteId, head)`,
  `savedCaret(noteId, docLength)` (clamps a stale head into `0..docLength`;
  unknown note → 0), and `forgetCaret(noteId)`. `Editor.svelte` takes a
  `noteId` prop, seeds `EditorState.create({ selection: { anchor:
  savedCaret(noteId, docText.length) } })`, and records the caret on EVERY
  `EditorView.updateListener` update (`update.state.selection.main.head`) —
  deliberately not gated on `update.selectionSet`, which only reflects
  explicitly-set selections and would miss remote-change-driven cursor
  shifts. `s/[id]` and `n/[id]` pass their note id into the keyed `<Editor>`
  and call `forgetCaret(id)` in their delete paths.
- Tests: 9 unit tests (`caret-memory.test.ts`: unknown→0, record, per-note
  independence, overwrite, clamp to shorter/empty doc, clamp negative,
  forget, forget-only-named) + 2 e2e (`e2e/caret-memory.spec.ts`):
  (a) `caret position is restored after switching notes` — type `hello
  world`, park the caret mid-line (End + 6×ArrowLeft), A→B→A, one typed
  char lands at the saved position (`helloX world`, NOT `Xhello world`);
  (b) `restored caret is clamped to the end when a collaborator shrinks the
  note` — the owner parks the caret at the end of an 11-char note and
  switches away; a LIVE edit collaborator (fresh browser context opening
  the edit share link, syncing over the server relay) shrinks the note to
  `hi` (2 chars); the owner's return clamps the stale caret to the end and
  a typed char lands there (`hi!`, NOT `!hi`). Both e2e tests
  sensitivity-verified: with the `selection` seed removed from
  `Editor.svelte`, both fail (the caret defaults to 0 — `Xhello world` /
  `!hi`). Full suite green twice: 323 unit + 130 e2e
  (5 pre-existing skips).
- Hand-off consumed: the iteration-11 note predicted the autofocus
  spec's note-switch expectation would flip to `'alpha note!'` once
  restoration landed — `e2e/autofocus.spec.ts` now asserts exactly
  `'alpha note!'`.
- Scope notes: in-memory / per-tab only (a reload starts at 0, per the
  slice); caret only (selection restoration still out of scope); the frozen
  `n/[id]` page also benefits because its note switch is an SPA navigation
  and the module-level map survives it. No screenshot impact — caret
  position is not asserted by any fixture (docker still unavailable here —
  see Parked).
- Learning: two LOCAL tabs of the same session do NOT sync in real time —
  `y-indexeddb` is persistence-only (see Parked) — so the clamp e2e had to
  use the server relay (a fresh context + edit link), not a second local
  tab.

### 21. DONE (2026-08-21, run 3, iteration 1): Per-note undo history survives note switches

- Evidence: new `src/lib/undo-memory.ts` — a per-tab (module-level)
  `WeakMap<Y.Text, Y.UndoManager>` with `getUndoManager(ytext)`
  (create-or-reuse) and `forgetUndoManager(ytext)` (destroy + evict).
  `Editor.svelte` takes the manager from the registry on mount and no
  longer destroys it on unmount, so every `{#key noteId}` remount (note
  switch, preview toggle, new note, delete-current-note replacement)
  re-attaches to the SAME manager and its intact undo/redo stack. Remount
  safety verified against y-codemirror.next 0.3.5 dist: the per-mount
  `YUndoManagerPluginValue` registers its `stack-item-added/popped`
  listeners and tracked origin per instance and unregisters both in
  `destroy()` (no accumulation), and `addTrackedOrigin` is Set-based
  (idempotent). `s/[id]` `removeNoteById` forgets the doomed note's
  manager BEFORE `removeNote` (session docs outlive their notes, so without
  the forget the manager keeps observing an orphaned Y.Text until reload);
  `n/[id]` does the same on its delete path (belt-and-braces — yjs also
  auto-destroys a manager when its Y.Doc is destroyed, pinned by a unit
  test).
- Behavior notes: the long-lived manager keeps observing while unmounted,
  so edits applied to the note's Y.Text while it is closed are recorded
  (only null-origin and per-mount syncConf edits — relay updates arrive as
  origin `'collab-remote'` and are NOT tracked, same as before). Side
  effect: a preview checkbox toggle (a null-origin `doc.transact` while the
  editor is unmounted) is now undoable — locked by e2e. Per-tab scope:
  switching SESSIONS within a tab also preserves history (session docs are
  cached in a module-level map, so the same Y.Text object comes back); a
  reload starts empty, like caret memory.
- Tests: 8 unit tests (`undo-memory.test.ts`: identity across remounts,
  per-text distinctness, stack survives a simulated unmount/remount with a
  tracked syncConf-style origin, null-origin edit recorded while unmounted,
  untracked relay origin NOT recorded, forget → fresh history, forget
  idempotent/no-op, recording stops when the Y.Doc is destroyed) + 4 e2e
  tests (`e2e/undo-memory.spec.ts`): (a) A→B→A note switch — Ctrl+Z reverts
  the A-typing to the empty placeholder, Ctrl+Y redo re-applies it; (b)
  preview-toggle round trip preserves the stack (same assertions); (c) a
  preview checkbox toggle applied while the editor is unmounted is undoable
  on return (one Ctrl+Z flips the marker back, with a 600 ms settle so the
  toggle is its own capture-window step); (d) a faithful real-browser
  Ctrl+Shift+Z keydown (synthetic `KeyboardEvent` with `key: 'Z'`) is
  consumed and redoes — see item 22. Sensitivity-verified: reverting to
  `new Y.UndoManager(ytext)` fails 3 of the 4; removing the item-22 binding
  fails (d). Full suite green twice: 331 unit + 134 e2e (5 pre-existing
  skips).
- Screenshots: no visible change (manager lifecycle + one keymap entry);
  the fixtures use `fill()`, never switch notes with pending undo, and never
  press Ctrl+Shift+Z / Ctrl+Y — committed PNGs cannot change (docker still
  unavailable in this env, see Parked).
- Learning (parked below): yjs 13.6.31 `Text.insert(index, text, attrs?)`
  has NO origin parameter — unit tests must set the origin via
  `doc.transact(fn, origin)`; a 4th argument is silently treated as rich
  text attributes.

### 22. DONE (2026-08-21, run 3, iteration 1): Redo chord Ctrl/Cmd+Shift+Z is live (was dead on every platform)

- Discovery (item 21's redo side): while locking item 21's done-when, the
  `Control+Shift+z` e2e press never redid. Root cause, verified against
  `@codemirror/view` 6.43.7 dist (identical in 6.43.9) and by in-page
  synthetic-event probes: CM6's keymap lookup builds the event key name
  from `e.key`, which is UPPERCASE when Shift is held (`'Z'`), while
  keymap bindings are stored lower-cased by `normalizeKeyName`
  (`'Shift-Ctrl-z'`). The lookup is a case-sensitive object property, so
  y-codemirror.next's `Mod-Shift-z` redo binding — and CM6
  `defaultKeymap`'s own `linux: "Ctrl-Shift-z"` redo entry — can never
  match a real Ctrl/Cmd+Shift+Z keypress on ANY platform. Observed
  consequences: Win/Linux fell through to the browser's native
  contenteditable redo (stale native stack, desyncs the Yjs one); macOS had
  NO working redo chord at all (`Mod-y` is mac-overridden to the equally
  dead `Mod-Shift-z`); and under CDP/Playwright dispatch (which does NOT
  apply the Shift case mapping — `Control+Shift+z` delivers `e.key: 'z'`)
  the press was silently running UNDO instead (first lookup branch ignores
  Shift for character keys and matched `Mod-z`).
- Fix: `Editor.svelte` keymap gains one entry right after
  `yUndoManagerKeymap`: `{ key: 'Mod-Shift-Z', run: () =>
  undoManager.redo() != null, preventDefault: true }` — uppercase `Z`
  normalizes to the exact real-browser event name (`Shift-Ctrl-Z` /
  `Shift-Meta-Z`), and the command uses the shared manager from the
  mount closure (y-codemirror does not export its redo command or facet).
  No new chord: Mod+Shift+Z was already the app's intended redo binding —
  this makes that intent work; it is not browser-reserved (it is the
  platform-standard redo).
- Evidence: e2e (d) above dispatches the faithful real-browser event
  (`key: 'Z'`, `code: 'KeyZ'`, ctrl+shift) and asserts it is consumed
  (`defaultPrevented`) AND the document actually redoes; sensitivity
  verified (fails without the binding). `Ctrl+Y` (the pre-existing
  `Mod-y` binding) remains the portable fallback and is what e2e (a)/(b)
  use. Full suite green twice: 331 unit + 134 e2e.

### 24. DONE (2026-08-21, run 3, iteration 2): Restore the per-note SELECTION (not just the caret) on note switch

- Evidence: `src/lib/caret-memory.ts` → `src/lib/selection-memory.ts` — a
  per-tab (module-level) `Map<noteId, { anchor, head }>` with
  `recordSelection(noteId, anchor, head)`, `savedSelection(noteId,
  docLength)` (unknown note → `{ anchor: 0, head: 0 }`; both ends
  independently clamped into `0..docLength` — a shrunken doc keeps a
  backward selection backward and converges to a point when both ends
  clamp together), and `forgetSelection(noteId)`. `Editor.svelte` seeds
  `selection: savedSelection(noteId, docText.length)` — an empty range
  is a caret point, so the item-20 semantics fall out of the same code
  path — and records the full main selection (`anchor` + `head`) on
  EVERY `updateListener` update (same deliberate not-gated-on-
  `selectionSet` choice as item 20, so remote-change-driven selection
  shifts are recorded too). Both routes' delete paths now call
  `forgetSelection`. 14 unit tests (`selection-memory.test.ts`:
  unknown→zero point, caret point, forward, backward, per-note
  independence, overwrite, clamp-both/clamp-one/clamped-backward/
  collapse-together, empty doc, negative, forget, forget-only-named) +
  1 e2e (`e2e/selection-memory.spec.ts`, renamed from
  `caret-memory.spec.ts`): `selection is restored after switching notes`
  — type `hello world`, select the whole line with End +
  11×Shift+ArrowLeft (backward selection, anchor 11 head 0), A→B→A,
  `Control+b` wraps exactly the restored range → `**hello world**`;
  sensitivity-verified — with the seed reduced to the caret-only
  `{ anchor: head }` the same press wraps only `hello`
  (`**hello** world`) and the test fails. The pre-existing caret tests
  (a)/(b) are unchanged and green. Full suite green: 336 unit + 135 e2e
  (5 pre-existing skips).
- Why a multi-word selection in the e2e: a single-word selection is NOT
  a discriminator — the item-20 caret-only behavior restores the head
  (the word's start), and a Mod+B word-wrap from that caret wraps the
  same word; only a range a caret cannot reproduce (multi-word or
  partial-word) separates the two behaviors.
- Scope notes: in-memory / per-tab only, exactly like item 20 (a reload
  starts empty — item 25 will persist it); length-clamping, not CRDT
  position mapping (explicit non-goal); the frozen `n/[id]` page
  benefits too (SPA navigation, module-level map). No screenshot impact:
  no fixture switches notes with a pending selection and the fixtures
  pass `caret: 'hide'` (docker still unavailable in this env — see
  Parked).

### 26. DONE (2026-08-21, run 3, iteration 3): Scroll the viewport to the restored caret/selection on remount

- Verified gap (run 3, iteration 2 probe, removed after the finding):
  a remounted 40-line note with the saved caret on the LAST line
  (`Control+End` before switching) reported `scrollTop = 0`
  (scrollHeight 1224, clientHeight 676) — CM6 scrolls the selection into
  view on selection CHANGES but not for the INITIAL state's selection,
  and `EditorView.focus()` uses `focusPreventScroll` (verified in the
  6.43.7 dist), so the restored position (items 20/24) was invisible:
  the user returned to the top of a long note with the caret somewhere
  deep.
- Evidence: `Editor.svelte` onMount now dispatches the seeded main
  selection with `scrollIntoView: true` when it is a non-default
  position (`main.anchor !== 0 || main.head !== 0` — a restored
  position at the very top needs no scroll). The dispatch is a
  selection-only transaction: no doc change, so no Yjs step and no
  undo-clock reset (and no awareness sync — `yCollab` is wired with a
  null awareness here). It applies to EVERY mount (note switch,
  preview toggle, first load) and to read-only shared views alike.
  3 e2e tests (`e2e/scroll-restore.spec.ts`), all sensitivity-verified
  (with the dispatch removed, both scroll tests fail exactly on the
  `scrollTop > 0` assertion): (a) 40-line note + `Control+End` +
  A→B→A → `scrollTop > 0` and a typed `X` lands on `line 40X`;
  (b) a 5-line note that fits the viewport stays at `scrollTop = 0`
  (the dispatch still runs but `scrollIntoView` is "nearest", so an
  already-visible position does not move the view); (c) preview toggle
  round trip restores the scroll too, with the model's integrity
  checked via `article.preview br` count (39) while the editor is
  unmounted. Full suite green: 336 unit + 138 e2e (5 pre-existing
  skips).
- Test-shaping gotcha (also in Parked): CM6 6.43.x culls off-viewport
  lines into a `.cm-gap` placeholder, so the DOM-based `editorText`
  helper cannot read a tall note in full — the assertions target the
  visible tail (`endsWith('line 40X')`) and the preview (model) instead
  of the full editor text.
- No screenshot impact: the committed fixtures are shorter than one
  viewport and never park a deep caret before switching, so no PNG can
  change (docker still unavailable here — see Parked).

### 25. DONE (2026-08-21, run 3, iteration 4): Persist the per-note work position across reloads

- Premise (item 20's "in-memory / per-tab only" boundary): an accidental
  refresh / tab restore / crash landed the user at the top of a long
  note; Docs/Obsidian/Typora restore the working position across reloads.
- Evidence: new `src/lib/selection-persist.ts` — one per-tab pending
  slot + 500 ms debounce (`scheduleSelectionPersist`), idempotent
  `flushSelectionPersist` (clears the pending timer), module-scope
  browser-guarded flush on `visibilitychange: hidden` and `pagehide`.
  `db.ts` v3: a dedicated `selections` object store
  (`saveNoteSelection` / `getNoteSelection` / `deleteNoteSelection`).
  **Deviation from the seeded direction** (a field on the `Note`
  record): the persist path's read-modify-write would race
  `syncMetadata`'s debounced content write and could put a STALE
  `content` back over a fresher one; a separate store removes that race
  class by construction and keeps the document record purely document
  (local UI metadata in its own store — ADR 0001 intact: document
  bytes, export, and sync payloads untouched). `Editor.svelte`: the
  on-every-update listener also calls `scheduleSelectionPersist`; when
  the in-tab `selection-memory` has no entry for the note, a guarded
  async restore reads `getNoteSelection` and dispatches the clamped
  selection with `scrollIntoView: true` — skipped when the doc changed
  (`touched`) or the selection moved off the 0-point since mount (user
  already worked; a remote change moving the doc suppresses it too); a
  `restoring` flag keeps the mount-time {0,0} update from scheduling a
  persist that would overwrite the saved position while the read is in
  flight. `selection-memory.ts` gained `hasSelection` + `clampSelection`
  (shared clamp, now used by both restore paths). Both routes' delete
  paths call `deleteNoteSelection`. Side effect (intended, not gated on
  `editable`): read-only shared views persist their READING position
  too — "continue reading where you left off" on a shared link (the
  frozen `n/[id]` view keys it by the remote room id — a tiny orphaned
  record, never deleted locally; acceptable).
- Tests: 18 new unit — 6 `db.test.ts` (round trip, per-note
  independence, overwrite, unknown, delete, notes-store isolation), 6
  `selection-memory.test.ts` (`hasSelection`, `clampSelection`), 6
  `selection-persist.test.ts` (debounce boundary, coalescing,
  supersede, flush-cancels-timer, flush no-op, re-arm) — with fake
  timers restricted via `toFake: ['setTimeout', 'clearTimeout']`
  because fake-indexeddb's `queueTask` runs on `setImmediate`, which
  the default fake-timers set stalls (see Parked). 2 e2e
  (`e2e/selection-persist.spec.ts`): (a) type `hello world`, select the
  whole line BACKWARD (End + 11×Shift+ArrowLeft), 700 ms settle,
  `page.reload()`, Control+b wraps exactly the restored range →
  `**hello world**` (the item-24 discriminator across a reload); (b)
  40-line note + `Control+End` + settle + reload → `scrollTop > 0`
  (poll; item 26's scroll rides on the restore dispatch) and a typed
  char lands on `line 40X` (visible-tail assertion per the `.cm-gap`
  gotcha). Both halves sensitivity-verified: write side disabled → both
  fail with exactly `**hello** world` and `scrollTop = 0`; restore
  dispatch disabled → (a) fails, (b) still passes (its saved point is
  non-zero on both ends, so the toggle is not a discriminator there).
  Full suite green: 354 unit + 140 e2e (5 pre-existing skips).
- Scope notes: in-tab `selection-memory` always wins (no async dispatch
  when it has an entry); persistence is best-effort at crash time (the
  hide/pagehide flush can lose to a hard kill — the 500 ms debounce
  covers normal exits, which is what the reload e2e exercises); a shared
  session whose first remote update lands while the restore read is in
  flight skips the restore (conservative: the doc moved under the saved
  position); no screenshot impact (no fixture reloads, parks a deep
  caret, or changes content; docker still unavailable in this env — see
  Parked).

### 27. DONE (2026-08-21, run 3, iteration 5): Task-toggle keyboard command — Mod+Alt+L (completes the item-17 input trio)

- Gap (run-3, iteration-4 re-audit): task lists have three input paths
  — type + Enter-continuation (17a), bracket-token click in the editor
  (17b), preview checkbox (17c) — but NO keyboard command to turn the
  current line into a task or back. Typing `- [ ] ` by hand is six
  characters for a frequent writing action, and the app's north star is
  "writing aids live in the keyboard". The mouse/preview paths exist;
  the keyboard path is the missing half.
- Direction: pure `applyTaskToggle(doc, from, to)` + a keymap command
  routed through `ownUndoStep` (item 18), wired in `Editor.svelte`'s
  keymap. Line-based semantics like item 15's heading toggles: a line
  `(\s*)[-*+] \[[ xX]\] …` → strip the marker (task → plain item,
  bullet kept); a plain bullet line → insert `[ ] ` after the bullet +
  space; any other free line → prefix `- [ ] ` at column 0. No-ops:
  fenced code, table rows, setext pairs, ordered-list items (GFM allows
  ordered tasks, but v1 stays bullet-only — same posture as the setext
  no-op). Probe the syntax tree (`TaskMarker`, the 17a/17b precedent)
  where it distinguishes; a line regex is the fallback.
- Chord: **Mod+Alt+L** ("L for list") — audit row added below: free on
  Chromium/Firefox/Safari. The Mod+Alt+T alternative is REJECTED:
  Ctrl+Alt+T is a desktop-level terminal launcher on GNOME/Ubuntu, eaten
  before the browser (the item-12 Mod+N lesson, one layer up). CM6
  matches `Mod-Alt-l` through its keyCode fallback, so macOS
  Option-mangling is safe (item 14's verification of the same family).
- done-when: unit tests for the pure function (on/off round trip,
  `[X]`, nested indent, both bullet styles, ordered/fence/table/setext
  no-ops) + e2e: plain line → task (verified in the preview), task →
  plain item, own undo step, read-only shared-view no-op. Screenshots
  unaffected (keymap-only, fixtures contain no task lists).
- Evidence (run 3, iteration 5): new `src/lib/cm-task-toggle.ts` —
  `taskBlocked` (ancestor walk: FencedCode / CodeBlock / Table /
  OrderedList / SetextHeading1 / SetextHeading2 / HorizontalRule /
  Blockquote), `taskMarkerOnLine` (line-range `TaskMarker` probe), pure
  `applyTaskToggle`, `taskToggleCommand` via `ownUndoStep`,
  `taskToggleKeymap` (`Mod-Alt-l`); wired in `Editor.svelte` after
  `formatKeymap`. 50 unit tests (`cm-task-toggle.test.ts`) + 4 e2e
  (`e2e/task-lists.spec.ts`), the three behavioral ones
  sensitivity-verified (each fails without the keymap wiring). Full suite
  green: 404 unit + 144 e2e (5 pre-existing skips).
- Scope notes (v1, top-level only): ordered tasks (`1. [ ] x`) and
  blockquote tasks (`> - [ ] x`) are no-ops — lezer parses both WITH a
  `TaskMarker` (probe-verified iteration 5), so item 28 lifts the
  `OrderedList`/`Blockquote` ancestor block; the preview checkboxes
  (item 17c) already toggle those forms. An empty line toggles to
  `- [ ] ` WITH a trailing space (item 15's heading command yields a
  bare `##` without — deliberately different: GFM task detection
  requires a space after `]`, so the next typed character must already
  land in a valid task). A lone `-`/`*`/`+` character line is treated as
  a plain line (prefixed, like item 15's degenerate lines).
- Priority: consumed — see item 28 (its direct extension).

### 28. DONE (2026-08-21, run 3, iteration 6): Task toggle: ordered + blockquote tasks (extends item 27 to the remaining GFM task forms)

- Gap (run 3, iteration 5, probe-verified): GFM tasks exist in three
  forms — top-level bullets (item 27), ordered lists (`1. [ ] x`) and
  blockquotes (`> - [ ] x`). Lezer emits `OrderedList > ListItem > Task
  > TaskMarker` for the ordered forms (all of `1.` / `1)` / nested) and
  `Blockquote > … > Task > TaskMarker` for the quoted forms, so item 27's
  TREE-MARKER strip branch already computes the right change for both —
  `taskBlocked`'s `OrderedList` / `Blockquote` ancestor block is what
  turns them into no-ops today. The preview checkboxes (item 17c,
  `task-lines.ts` scanner covers ordered + blockquote) already toggle
  every form; the keyboard path is the last missing one.
- Direction: (a) ordered — lift `OrderedList` from `taskBlocked` ONLY for
  the marker-strip branch (a plain `1. x` line still no-ops in v1 —
  inserting `[ ] ` after an ordered marker is a second regex branch,
  `(\s*)(\d{1,9})[.)][ \t]`, and can land as a follow-up slice if wanted);
  (b) blockquote — lift `Blockquote` for the marker-strip branch AND add a
  `>␣` prefix variant of the bullet/free-line regexes so `> - x` →
  `> - [ ] x` and `> hello` → `> - [ ] hello` (or decide quoted tasks are
  strip-only — the preview checkbox already covers the other direction
  there). Keep fenced code / tables / setext / thematic breaks blocked.
- No new chord (same Mod+Alt+L; audit row unchanged).
- done-when: unit tests for the new branches (ordered strip, blockquote
  strip, blockquote bullet insert if included, both inside existing
  `taskBlocked`/`applyTaskToggle` suites) + e2e: `1. [ ] x` → `1. x` and
  `> - [ ] x` → `> - x` (verified in the preview checkbox state), plus the
  plain `1. x` no-op if ordered insert is not included. Screenshots
  unaffected (keymap-only).
- Evidence (run 3, iteration 6): `cm-task-toggle.ts` — `BLOCKED_ANCESTORS`
  loses `OrderedList` / `Blockquote` in favor of a new `TASK_FORM_ANCESTORS`
  set that is only consulted when the line has **no** `TaskMarker`;
  `taskBlocked(state, line, marker)` gains the marker parameter and the
  command computes `taskMarkerOnLine` before the block check (the strip
  branch of `applyTaskToggle` is unchanged — it already computed the right
  change for both forms, probe-verified: lezer emits
  `OrderedList > ListItem > Task > TaskMarker` for `1.` / `1)` / nested and
  `Blockquote > … > Task > TaskMarker` for `> -` / `> > -` / `> 1.`, with the
  marker at the same relative offset in every case). 16 new unit tests
  (`cm-task-toggle.test.ts`: ordered strip dot/checked/paren/nested/second-
  item-untouched; blockquoted strip bullet/checked/deep-nested/ordered/
  following-line-untouched; `taskBlocked` allow-with-marker vs
  block-without-marker per form, fence still hard-blocks) + 4 e2e
  (`e2e/task-lists.spec.ts`), the two strip tests sensitivity-verified (fail
  exactly with the old always-block behavior; the no-op tests pass both ways,
  locking the no-op contract). Full suite green: 420 unit + 148 e2e
  (5 pre-existing skips).
- Scope notes (v1, strip-only for both forms): the *insert* direction —
  `1. x` → `1. [ ] x` and `> - x` / `> note` → task — is NOT included: it is
  a second regex branch per form and changes document structure more
  (a quoted plain line becomes a quoted list); the preview checkbox (17c)
  already toggles every form, so "make it a task" stays reachable there.
  Seeded as item 29. A bare marker-only line (`1. [ ]` with no content)
  parses without a `TaskMarker` like its top-level counterpart, so it is a
  no-op here (top-level strips it via the regex fallback) — degenerate case,
  consistent with the no-op posture.
- Priority: consumed — see item 29 (ordered task continuation, found by the
  iteration-6 re-audit).

### 29. DONE (2026-08-21, run 3, iteration 7): Ordered task continuation keeps the `[ ] ` marker on Enter (upstream gap)

- Gap (run 3, iteration 6, probe-verified against the installed
  `@codemirror/lang-markdown` 6.5.1 dist): Enter-continuation treated the
  three GFM task forms asymmetrically. Bullets: `- [ ] x` + Enter →
  `- [ ] x\n- [ ] ` (marker continued, unchecked — item 17a). Blockquotes:
  `> - [ ] x` + Enter → `> - [ ] x\n> - [ ] ` (quote + bullet + marker all
  continued). **Ordered**: `1. [ ] x` + Enter → `1. [ ] x\n2. ` — the
  `[ ] ` marker was DROPPED, an empty `1. [ ] ` + Enter did NOT exit the
  list, and an empty SECOND item of a tight list CORRUPTED the marker
  (`1. [ ] a\n2. [ ] ` + Enter → `1. [ ] a\n2. [\n3. ] ` — the built-in
  split mid-marker).
- Root cause (verified in the dist): `insertNewlineContinueMarkup` builds
  its continuation context in `getContext`, whose per-form regexes capture
  the task marker ONLY for bullets — BulletList:
  `/^( *)([-+*])( {1,4}\[[ xX]\])?( +)/` (marker = group 3) vs OrderedList:
  `/^( *)\d+([.)])( *)/` (no marker group). The re-emitted continuation line
  therefore never carries the ordered task marker; and the built-in's
  "empty item" test slices the line AFTER the ordered marker (which ends
  before `[ ] `), so an ordered task's own marker counts as "content" and
  the exit branch never runs.
- Evidence (run 3, iteration 7): new `src/lib/cm-task-newline.ts` — pure
  `orderedTaskNewlineChanges(state)` (gates on a single empty caret, an
  ordered-task line regex `((?:> ?)*)([ \t]*\d+[.)])[ \t]+(\[[ xX]\])…`, and
  the tree `TaskMarker`'s INNERMOST list — a bullet task nested in an
  ordered item must fall through), `orderedTaskNewlineCommand` (via
  `ownUndoStep`, item 18) and `orderedTaskNewlineKeymap` (`Enter`);
  `Editor.svelte` wires it at `Prec.highest(keymap.of(…))` — required, since
  `markdown()`'s `markdownKeymap` is `Prec.high` and would otherwise run
  first. Path (a) content: run `insertNewlineContinueMarkup` with a
  CAPTURED dispatch, find the change whose insert carries the newline, take
  the tail after its last `\n`, match the final `(\d+[.)])` marker, and
  compose a patch that splices ` [ ] ` over the marker's trailing spaces —
  one composed transaction, so caret mapping and the undo step are exact
  (mid-line splits put the marker before the remainder; renumber changes and
  quote prefixes pass through untouched). Path (b) empty: delete just the
  `[x]` token into a local `ChangeSet`, run the built-in on the STRIPPED
  state, then `remove.compose(builtinChanges)` — the built-in's own
  empty-item logic (exit / tight→loose blank line / renumber / blockquote
  `> ` exit) then executes on a plain empty ordered item, mirroring the
  bullet semantics with zero duplication of upstream code. Bullet tasks
  (top-level and nested-in-ordered — their built-in continuation already
  carries the marker), plain ordered lines, `1.[ ] x` (not a list), fenced
  lines, and non-list lines all fall through to the built-in / default
  Enter unchanged. 18 unit tests (`cm-task-newline.test.ts`: unchecked /
  checked→unchecked / paren / nested-indent / quoted / renumber / mid-line
  split; empty single / no-trailing-space / blank-line-preceded /
  tight-loose / quoted exit; the five fall-through no-ops) + 4 e2e
  (`e2e/task-lists.spec.ts`: continuation + type with the preview checkbox
  count 1→2 and `data-task-line` 1/2, empty-item exit to a plain line, the
  tight-list Enter ladder `2. [ ] ` → `\n2.  ` → exit, own undo step) — all
  4 sensitivity-verified (each fails with the `Prec.highest` wiring removed,
  exactly on the missing-marker / missing-exit assertions). Full suite
  green: 438 unit + 152 e2e (5 pre-existing skips).
- No new chord (Enter). No screenshot impact: keymap-only, the fixtures
  never press Enter on an ordered task list (docker still unavailable in
  this env — see Parked).
- Scope notes: the *insert* direction (`1. x` → `1. [ ] x`, `> - x` →
  `> - [ ] x`) stays out of this item (item 28's v1 decision) — seeded as
  item 30. Backspace on an empty ordered task still deletes char-by-char
  (bullet asymmetry, probe-verified iteration 7) — seeded as item 31.

### 30. DONE (2026-08-21, run 3, iteration 8): Mod+Alt+L insert direction for ordered and blockquoted tasks (completes item 28's strip-only v1)

- Gap: Mod+Alt+L strips the marker from ordered (`1. [ ] x` → `1. x`) and
  blockquoted (`> - [ ] x` → `> - x`) tasks (item 28) but can never INSERT
  it — a plain `1. x` or `> - x` line no-ops, while the top-level bullet
  line gets `[ ] ` (item 27). The preview checkbox (17c) already toggles
  every form, so "make it a task" is reachable by mouse; the keyboard path
  is the parity gap (the north star keeps writing aids in the keyboard).
- Direction: two regex branches in `applyTaskToggle` — (a) ordered: a line
  `([ \t]*\d+[.)])[ \t](.*)` with NO `TaskMarker` on the line inserts `[ ] `
  after the ordered marker (`1. x` → `1. [ ] x`, all of `1.` / `1)` /
  nested indent); (b) blockquote bullet: `> - x` → `> - [ ] x` (insert
  after the in-quote bullet marker). A plain quoted line (`> note`) stays a
  no-op — item 28's deliberate structural-change concern (it would become a
  quoted list). `taskBlocked` must stop blocking `OrderedList` /
  `Blockquote` marker-less lines for the new branches (the strip branch
  already relies on the marker parameter — keep it). Route through
  `ownUndoStep` as today. No new chord (Mod+Alt+L).
- done-when: unit tests for both insert branches (+ `> note` no-op, existing
  strip tests unchanged) + e2e: `1. x` + Mod+Alt+L → `1. [ ] x` with the
  preview checkbox count 0→1, and `> - x` → `> - [ ] x` likewise.
  Screenshots unaffected (keymap-only).
- Evidence (run 3, iteration 8): `cm-task-toggle.ts` — new pure
  `taskInsertLine(line)` (ordered: optional quote prefix `((?:> ?)*)` +
  `[ \t]*\d{1,9}[.)]` + space → splice `[ ] ` after the marker; blockquoted
  bullet: `((?:> ?)+)` + optional indent + `[-*+]` + space → splice after
  the bullet; anything else → `null`), an `insertable = false` parameter on
  `taskBlocked` (the `OrderedList` / `Blockquote` ancestor block now applies
  only when the line has neither a `TaskMarker` nor an insert match — the
  hard blocks are checked first and unchanged), and two new
  `applyTaskToggle` branches tried AFTER the strip branches (order is
  load-bearing: `taskInsertLine('1. [ ] x')` would match with content
  `[ ] x`, so a marked line must strip, never double-insert). Deliberate
  scope extension of the seeded direction: the ordered branch carries the
  quote prefix, so `> 1. x` → `> 1. [ ] x` — the inverse of item 28's
  quoted-ordered strip. Caret mapping refined while in there: `place()` now
  shifts only positions at/after the line-relative insert point (the strip
  branch keeps the uniform delta shift) — a caret parked before the marker
  no longer jumps into the inserted `[ ] ` (also improves the pre-existing
  bullet branch; no test locked the old jump). 32 unit tests
  (`cm-task-toggle.test.ts`: both insert forms incl. paren / nested-indent /
  single- + deep-quote / no-space-quote / post-quote-indent variants,
  caret-in-place and selection shift, empty `1. ` item, ten-digit marker
  falling through to the plain prefix, `taskInsertLine` null cases,
  `taskBlocked` insertable gating incl. the fence hard-block override and
  the plain-quoted-line block) + 4 e2e (`e2e/task-lists.spec.ts`: `1. x` →
  `1. [ ] x` with the preview checkbox count 0→1, `1) x` insert +
  second-press strip round trip, `> - x` → `> - [ ] x` with checkbox 0→1,
  own undo step) — all 4 sensitivity-verified (each fails with the
  `insertable` gating removed). The former "no-op on a plain ordered line"
  e2e is replaced by the ordered insert test; the plain-quoted-line no-op
  e2e is unchanged and still green. Full suite green: 470 unit + 155 e2e
  (5 pre-existing skips). No new chord (Mod+Alt+L; audit row unchanged). No
  screenshot impact: keymap-only, fixtures contain no ordered/blockquoted
  task lists (docker still unavailable in this env — see Parked).
- Scope notes: a bare `1.` line (no space, no content) stays a no-op — the
  regex requires the GFM item space (a bare `-` still takes the plain-line
  prefix, item 27's degenerate case); `1. ` (trailing space) inserts fine;
  a ten-digit `1234567890. x` is not a CommonMark list item (`\d{1,9}`
  matches the 1–9 digit rule and the parser agrees) and takes the plain-line
  prefix; 4+ post-quote spaces (`>     - x`) are an indented code block,
  hard-blocked by the tree.
- Priority: consumed — next unblocked: item 31 (Backspace on an empty
  ordered task).

### 31. Backspace on an empty ordered task item does not exit the list (bullet asymmetry)

- Gap (run 3, iteration 7, probe-verified against the installed
  `@codemirror/lang-markdown` 6.5.1): `- [ ] ` + Backspace at line end →
  the built-in `deleteMarkupBackward` strips the whole marker and exits
  (doc `''`) — but `1. [ ] ` + Backspace → `handled: false` (the ordered
  context ends at `1. `, before the task marker — the same item-29 root
  cause), so the DEFAULT Backspace deletes char-by-char (`]`, ` `, `[`, …)
  instead of exiting in one press.
- Direction: an app-level Backspace wrapper (a keymap entry alongside the
  item-29 Enter one, tried before `markdownKeymap`): when the caret's line
  is an EMPTY ordered task (item 29's regex, no content) and the caret sits
  at/after the marker, delete the `[x]` token and re-run
  `deleteMarkupBackward` on the stripped state (compose like item 29's
  path (b)); everything else falls through. Route through `ownUndoStep`.
  No new chord (Backspace).
- done-when: unit tests (ordered empty exit, bullet control unchanged,
  non-empty ordered task no-op, fence no-op) + e2e: `1. [ ] ` + Backspace →
  plain empty line (mirroring the existing bullet test). Screenshots
  unaffected.
- Priority: TOP UNBLOCKED.

### 23. BLOCKED (product decision): Typewriter scrolling (keep the caret near mid-viewport while typing)

- Candidate found by the run-3 writing-experience re-audit: no
  writing-app default in this codebase keeps the caret vertically centered
  while scrolling (iA Writer / Typora behavior); today the view scrolls
  only when the caret hits the bottom edge (CM6 default). A small CM6
  `ViewPlugin` (scroll the `scrollDOM` so the caret sits ~40% down when it
  is near the top edge after a change) is the obvious implementation.
- BLOCKED on a human product decision: it changes default behavior for
  every session (some users dislike mid-caret scrolling), it interacts
  with the mobile virtual keyboard and manual scrolling, and it needs a
  decided default (on-always vs. opt-in). Name the decision before
  scoping.

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
| Mod+N                | **reserved** (new window)    | **reserved** (new window) | **reserved** (new window)           | rejected (old new-session binding; dead in real browsers, see item 12) |
| Mod+Alt+S            | free                         | free                     | free                                  | **new session** (substitution for the dead Mod+N, item 12) |
| Mod+Shift+Z          | free (page-level redo, not a browser accelerator) | free (page-level redo) | free (standard text redo) | **redo** — y-codemirror's intended `Mod-Shift-z` binding; added as uppercase `Mod-Shift-Z` so CM6's case-sensitive key-name lookup actually matches a real Shift+Z keypress (item 22) |
| Mod+Alt+L            | free                         | free                         | free                                  | **task toggle** (item 27, shipped run 3 iteration 5; CM6 matches `Mod-Alt-l` through its keyCode fallback, so macOS Option-mangling is safe per item 14's family check). Mod+Alt+T rejected: Ctrl+Alt+T is a desktop-level terminal launcher on GNOME/Ubuntu, consumed before the browser (the item-12 Mod+N lesson, one layer up) |

Notes: the substitutions follow the Mod+Alt pattern this app already established for
the rejected Mod+Shift+N / Mod+Shift+P (items 7, 8), keeping all substituted chords in
one family. Mod+Alt+1..6/0 must be matched via `e.code` (`Digit1`..`Digit6`, `Digit0`)
on macOS (Option alters `e.key`) exactly like the existing Mod+Alt+N/P handlers.
Ctrl+Alt+digit has no known collision with IME or screen-reader modifiers on the three
platforms (NVDA/JAWS use different modifiers).

## Parked (noticed, not yet scoped)

- **`pkill -f` matches its own command line (run 3, iteration 8):** the
  stale-proc kill step `pkill -f "vite preview"` matches the shell running
  the command itself (the pattern appears in its argv), kills it, and the
  bash call hangs until the 120 s timeout. Use a self-excluding pattern
  (`pkill -f "[v]ite preview"`), check with `pgrep -a -f` first, or just
  confirm `ss -ltn | grep -E ':(3000|4173)'` is empty before an e2e run.
- **lezer ordered-task marker presence is trailing-space-dependent
  (run 3, iteration 7):** `1. [ ] x` AND `1. [ ] ` (with a trailing space)
  parse as `OrderedList > ListItem > Task > TaskMarker`, but `1. [ ]`
  (no trailing space, no content) parses as `OrderedList > ListItem >
  Paragraph` with NO `TaskMarker` (same as the bullet `- [ ]` → `Paragraph`
  premise of item 17b). Any "is this an empty ordered task" check therefore
  needs the LINE REGEX, not the tree, as the discriminator (item 29's path
  (b) keys on the regex; the tree only excludes bullet-nested tasks).
- **The built-in corrupts an empty ordered task on Enter (run 3, iteration
  7):** `1. [ ] a\n2. [ ] ` + Enter → `1. [ ] a\n2. [\n3. ] ` — because the
  ordered context ends before `[ ] `, the "empty item" exit never runs, the
  continuation inserts at the caret, and the trailing-whitespace back-walk
  stops at `]`, splitting the marker across two lines. This is why item 29
  must strip the `[x]` token BEFORE running the built-in for empty items
  (never "fix" the built-in's output in that case).
- **`@codemirror/state` 6.7.1 ChangeSet API traps (run 3, iteration 7):**
  (1) `ChangeSet.of(changes, length)` / `ChangeSet.empty(length)` take a
  NUMERIC document length, not a doc — there is no `ChangeSet.single()` or
  `.replace()` in this version; (2) `X.compose(Y)` = apply X first, then Y
  (Y expressed in X's OUTPUT coordinates) — verified empirically, the
  reverse direction throws on length mismatch; (3) `ChangeSet` has no
  `.includes`-bearing iteration — `iterChangedRanges`'s callback is TYPED
  with 4 params (no insert), while `iterChanges` exposes the 5th `inserted:
  Text` (use `.toString()`); (4) `state.update()` takes TransactionSpec
  OBJECTS — passing a bare ChangeSet silently applies NOTHING (no error);
  (5) `Transaction.selection` is typed `EditorSelection | undefined`
  (guard it).
- **TS closure-assignment narrowing trap (run 3, iteration 7):**
  `let x: T | null = null` assigned ONLY inside a callback passed to a
  function call stays narrowed to `null` in control-flow analysis after the
  call — `if (!x) return` then leaves `x: never` for all later reads.
  Fix used in `cm-task-newline.ts`: a `const holder = { tr: null }` object
  (property reads are re-narrowed fresh). Same family as the "TreeCursor is
  reused and mutated" gotcha below.
- **lezer markdown node names for line-level guards (run 3, iteration 5):**
  three premises that shaped `taskBlocked` (and any future line-level
  command): (1) a thematic break (`---` / `===`-is-paragraph / `***`)
  parses as `HorizontalRule`, NOT `ThematicBreak`; (2) `SetextHeading1/2`
  spans BOTH the paragraph line and the underline line (the underline is
  the `HeaderMark` child), so an ancestor walk from either line reaches
  the setext node — a tree guard covers both setext lines without the
  item-15-style regex; (3) ordered GFM tasks (`1. [ ] x`, `1)`, nested)
  parse as `OrderedList > ListItem > Task > TaskMarker` — the strip
  branch of any marker-based command works for them as soon as the
  `OrderedList` ancestor block is lifted (seeded as item 28).
- **`doc.lineAt(pos)` at a line end stays on that line (run 3, iteration
  5):** probing `lineAt` at the newline position of a non-final line
  returns THAT line (and at the document end returns the last line), so
  the same-line guard pattern `lineAt(to).number !== lineAt(from).number`
  (items 15/27) correctly accepts a caret parked at the very end of the
  line. No off-by-one needed.
- **Undo/redo history does not survive reloads (run 3, iteration 4):**
  item 21's per-tab manager registry is in-memory; after a reload the
  undo stack is empty even though the work position (item 25) is
  restored. There is no documented yjs API to serialize an
  `UndoManager` stack (stack items hold internal `Yjs Item` references
  with `keepItem` pins), so a scoped item needs a spike first (e.g.
  persist the pre-step doc state per captured step and rebuild, or
  accept "undo survives reloads for N steps"). Not started.
- **Autolink bare URLs on type (run 3, iteration 4):** an input rule
  that rewrites `scheme://…` tokens into `[url](url)` after a word
  boundary would complete the link story (item 16 covers paste +
  Mod+K). BLOCKED on a product decision: it rewrites STORED document
  content behind the user's back (marks appear on the line, against
  the concealment philosophy), and needs decided scope — which URL
  forms (item 16's validation deliberately refuses `www.…`; email?
  bare-domain TLD heuristics?). Name the decision before scoping.
- **fake-indexeddb stalls under default `vi.useFakeTimers()` (run 3,
  iteration 4):** `fake-indexeddb`'s `queueTask` uses
  `globalThis.setImmediate` in node (falling back to `setTimeout(0)`
  in jsdom), and vitest's default fake-timers set fakes
  `setImmediate` too — every IDB op hangs forever. Unit tests that
  combine fake timers with fake-indexeddb must restrict
  `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` (or
  whatever the SUT uses) so the IDB task queue keeps flowing.
- **CM6 6.43.x culls off-viewport lines into `.cm-gap` placeholders
  (run 3, iteration 3):** for a document taller than the viewport,
  `@codemirror/view` 6.43.7 replaces the run of lines outside the
  scroll viewport with a single empty `div.cm-gap` carrying the
  combined height (verified: 40-line note, remounted at `scrollTop = 0`
  → 36 `.cm-line` + one `.cm-gap` (≈3.9 lines) + the line containing the
  selection, which is always kept rendered). The INITIAL mount renders
  ALL lines before the first gap pass, so a DOM read right after mount
  can transiently see the full text — a race. Consequence: the DOM-based
  `editorText` e2e helper is UNRELIABLE for notes taller than one
  viewport (it silently loses the gapped lines, which looks like
  document corruption). For tall-note e2e, assert on the visible tail
  (`text.endsWith(...)` at a known scroll position) and read the MODEL
  through the preview (with `breaks: true`, N lines → N-1
  `article.preview br` — `<br>` contributes nothing to `textContent`,
  so `allTextContents()` on the preview paragraph also collapses the
  lines).
- **CM6 scroll mechanics (run 3, iteration 3, verified in the 6.43.7
  dist):** the view's update loop sets a scroll target whenever
  `tr.scrollIntoView` is true — regardless of whether the transaction
  changed the selection — so a selection-only dispatch
  (`view.dispatch({ selection: view.state.selection.main,
  scrollIntoView: true })`) is a safe way to scroll a restored position
  into view (no doc change → no Yjs step, no undo-clock reset). The
  scroll is applied in the next measure cycle (rAF), so e2e must
  `expect.poll` on `scrollTop`. `EditorView.focus()` uses
  `focusPreventScroll` and NEVER scrolls the selection into view — that,
  plus "the initial state's selection is not scrolled", is the full
  account of the item-26 gap.
- **Playwright `fill()` on a tall contenteditable (run 3, iteration
  3):** `fill()` leaves the caret at the end of the inserted text and
  CM6 scrolls it into view — after filling a 40-line note the scroller
  already reported `scrollTop ≈ maxScroll` (499 of 522). Parking a caret
  in e2e after a fill therefore needs an explicit `Control+End` for
  determinism, and the pre-park viewport is already near the bottom, not
  the top.

- **CDP key dispatch does NOT apply the Shift case mapping (run 3,
  iteration 1):** `page.keyboard.press('Control+Shift+z')` delivers
  `e.key: 'z'` (lowercase) even with Shift held, while a real browser
  delivers `e.key: 'Z'`. CM6 keymap branches behave differently on the two
  casings (the first lookup branch ignores Shift for character keys, so
  the CDP press of Ctrl+Shift+z matches the plain `Mod-z` UNDO binding,
  while the real press matches nothing). E2E tests for Shift+letter chords
  cannot be trusted in either direction — for the real-browser path,
  dispatch a synthetic `KeyboardEvent` with the faithful casing
  (`{ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true }`) on
  `.cm-content`; that is what `e2e/undo-memory.spec.ts` does. Extends the
  existing "CDP bypasses the accelerator layer" note below.
- **yjs 13.6.31 `Text.insert` has no origin parameter (run 3, iteration
  1):** the signature is `insert(index, text, attributes?)` — a 4th
  argument is silently treated as rich-text attributes and the transaction
  records origin `null`. To record a specific origin in tests, use
  `doc.transact(() => text.insert(…), origin)`. (`Y.applyUpdate(doc,
  update, origin)` does take an origin — that is how the relay's
  `'collab-remote'` origin is set, and such edits are NOT tracked by a
  default `Y.UndoManager`.)
- **yjs `UndoManager` lifecycle (run 3, iteration 1):** a manager
  auto-destroys when its Y.Doc is destroyed (`doc.on('destroy', () =>
  manager.destroy())`), and `destroy()` is idempotent (lib0
  `ObservableV2.destroy` just resets the observer map) — so explicit
  `forgetUndoManager` + later doc-destroy double-destroy is harmless.
  Memory: there is no stack cap (no `maxStackItems` in 13.6.x), stack
  items pin deleted items via `keepItem`, and a destroyed manager stays
  referenced by the doc's `'destroy'` listener closure until the doc
  itself dies — for local sessions that is tab lifetime. Acceptable at
  current scale; revisit if long-lived tabs show memory growth.
- **Frozen `n/[id]` shared view leaks its Y.Doc (pre-existing, run 3,
  iteration 1):** the shared-note `$effect` creates a fresh `Y.Doc` per
  mount but only destroys it in the `cancelled` path — a normal leave
  stops the room and nulls `sharedYtext` but the doc (and, now, its undo
  manager) leaks until reload. Pre-existing (the doc itself leaked
  before undo-memory); fixing belongs to a frozen-page pass, if that ever
  happens.
- **y-indexeddb is persistence-only — no cross-tab sync (run 2, iteration
  12):** `IndexeddbPersistence` (y-indexeddb 9.0.12) applies stored updates
  exactly ONCE at construction (`fetchUpdates`) and stores local updates on
  change (`doc.on('update', …)`), but has no BroadcastChannel / object-store
  watch / polling — two tabs of the SAME local session do NOT see each
  other's edits until a reload. Verified in the installed dist source.
  Consequence: an e2e that needs a second LIVE local editor must use the
  server relay (fresh browser context + edit share link), not a second tab
  of the same context. The passive-recipient direction is reliable (share
  spec's "owner edits appear live in an open shared view" is green); the
  two-way convergence test remains `test.skip` (flaky). Product question
  (not scoped): should local sessions sync across tabs (e.g. a
  BroadcastChannel update exchange)? Today, editing the same session in two
  tabs diverges until reload.
- **Driving CM6 commands in unit tests (run 2, iteration 5):** `EditorState` has no
  `applyTransaction` — a command's `dispatch(tr)` receives a `Transaction`, and the
  resulting state is `tr.state` (lazily applied to `startState`). Pattern
  (`task-continuation.test.ts`): `let next = state; insertNewlineContinueMarkup({
  state, dispatch(tr) { next = tr.state; } })`. Also: `markdownLanguage.isActiveAt`
  (which gates the continuation command) is true in a plain `EditorState.create`
  with `markdown({ base: markdownLanguage })`, so no `EditorView` is needed.
- **lezer cursor/node iteration gotchas (run 2, iteration 4):** three traps hit while
  writing the Mod+K probes. (1) `Tree.iterate({enter})` hands the callback a
  **TreeCursor**, and its `.node` getter returns an internal `BufferNode`/`TreeNode`
  that has **no `.iterate`** — and `SyntaxNode` (an interface) has no `.iterate` at
  all. To scan a subtree from a spec callback, either use the cursor's own
  `cursor.iterate(enter)` (different signature: `(enter, leave)` args, not a spec
  object) or walk `SyntaxNode.firstChild` / `.nextSibling` manually (what
  `linkLabelEnd` now does). (2) `tree.resolve(pos, 1)` at a link's start returns the
  innermost node starting there — the `[` `LinkMark`, not the `Link` — so go one
  `.parent` up (guard on the name). (3) `tree.iterate({from, to})` reports nodes
  merely *adjacent* to the range (a cursor right after `)` still yields the link),
  so cursor-vs-link logic needs an explicit strict-containment check
  (`node.from < pos && pos < node.to`), and selection-vs-link logic an open-interval
  overlap check. (4, run 2 iteration 6) The TreeCursor handed to an `enter` callback
  is **reused and mutated** as the iteration advances: storing the reference
  (`found = node`) and reading `.name/.from/.to` later yields whatever node the
  cursor has moved to (observed: `Document`) — copy the needed values
  (`{ from: n.from, to: n.to }`) INSIDE the callback, or re-resolve via
  `tree.resolve(n.from, 1)`.
- **Setext headings vs heading toggles (run 2, iteration 3):** item 15 no-ops on a
  setext heading — both the paragraph line above a `=`/`-` underline and the underline
  line itself — instead of converting it. A conversion is lossless and small (level N:
  replace the underline line with an ATX prefix on the line above; level 0: delete the
  underline), so it is a good next slice only if real notes turn out to use setext
  headings. Until then the no-op is the safe behavior (it never mangles a document).
- **CM6 arrow keys collapse before moving (run 2, iteration 1):** with a non-empty
  selection, `ArrowDown`/`ArrowUp` (`cursorByLine` in `@codemirror/commands`)
  collapse the selection to its end/start instead of moving — e2e tests that wrap a
  selection (which leaves it selected) must collapse first (e.g. `End`) before the
  vertical move registers.
- **y-codemirror single Yjs origin (run 2, iteration 1; item 18 DONE in iteration 8):**
  for any future keymap command, route the dispatch through `ownUndoStep` in
  `src/lib/cm-undo.ts` or it will merge with adjacent typing into one undo step.
  Corrected details, verified against the installed yjs 13.6.31 +
  y-codemirror.next 0.3.5 source (the iteration-1 note was imprecise): the merge
  window is `captureTimeout = 500` ms (NOT 5 s); local CM edits are transacted to
  the `Y.Text` with origin = the ySync config object (NOT null), which `yCollab`
  registers on the manager via `undoManager.addTrackedOrigin(syncConf)`;
  `stopCapturing()` is just a `lastChange = 0` capture-clock reset. Trap pinned by
  a unit test: calling `stopCapturing()` around a SELECTION-ONLY dispatch (no doc
  change) would split a typing burst that straddles the cursor move —
  `ownUndoStep` therefore guards on `spec.changes !== undefined`.
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
  on 4173, so editor-only tests hang at the 30s test timeout.   **Recipe for a green local run:**
  kill any stale `mynotes-api` / `vite preview` procs and confirm ports 3000/4173 are free,
  then run `npx playwright test --config playwright.config.ts --workers=2` (Playwright starts
  fresh servers). Verified 3× green this way (66 passed). CI is unaffected — GitHub runners
  have few cores → few workers → low concurrency. Not committed as a config change (kept the
  diff to the feature); revisit if a future iteration needed a stable default.
  **RESOLVED (run 2, iteration 6):** root cause confirmed by differential runs — the suite
  was green with 7 concurrent share sessions and red with 8 (a new read-only e2e test was the
  8th): by the time the last share test ran, the per-IP token buckets (e.g. `RATE_WRITE_PER_MIN`
  for `PUT /notes/{id}`) could be empty, the share flow's PUT 429s, and the share panel never
  opens (the API does NOT log 429s, so the failure looks like a silent render stall). Fix:
  `playwright.config.ts` webServer now starts the e2e API with generous limits
  (`RATE_CREATE/WRITE/WS_PER_MIN=1000`, `RATE_READ_PER_MIN=5000`, `MAX_WS_PER_IP=100`) —
  e2e-only envs, production defaults in `api/src/config.rs` untouched, and no e2e test depends
  on the defaults (verified by grep). 2× full-suite green (114 passed) after the fix. The
  stale-proc kill is still required because `reuseExistingServer: !CI` reuses a rate-limited
  API process.
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
- **Clicking a specific character in e2e (run 2, iteration 6):** a `.cm-line` is a
  FULL-WIDTH block (100% of the content area), so `locator('.cm-line').click()`
  (element center) lands far past the end of any short line → `posAtCoords` clamps
  to the line end. That is why the pre-existing "click the line" tests reliably put
  the caret at the line end (and never on a left-aligned token like a `TaskMarker`).
  To click a specific character, compute its pixel point in `page.evaluate`
  (TreeWalker over the line's text nodes to find the offset, then a 1-char
  `Range.getBoundingClientRect()` center) and `page.mouse.click(x, y)`. This is what
  the task-list bracket-click tests use to hit the 3-char marker precisely.
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
