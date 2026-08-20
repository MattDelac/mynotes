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
- `~~strikethrough~~` in the editor: concealed tildes on inactive lines, line-through
  on the text (grammar support comes from transitive `@lezer/markdown`, see item 3)
- List continuation on Enter (bullets, ordered auto-numbering, blockquotes) via
  `markdownKeymap` in `@codemirror/lang-markdown` (`markdown()` adds it by default);
  Backspace on an empty item dedents/removes the marker
- Table Enter keymap (`cm-table.ts`): separator insert, row continuation, empty-row delete
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
