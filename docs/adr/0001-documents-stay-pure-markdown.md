# Documents stay pure markdown; no binary media

MyNotes documents are markdown text only. We deliberately cut the images feature after
shipping its design doc and implementation phases 1–2 (write-once blob store,
client-side paste/drag-drop insertion). The code is preserved on branch
`gnhf/you-are-the-overnigh-b4640b` (PR #31, closed unmerged) if the decision is ever
revisited.

**Consequences**: export is the file itself; the server stays an opaque byte pipe; the
editor stays honest — what you type is what is stored. Any future media support
requires re-opening this decision explicitly.

**Considered options**: keep images as the one binary exception (rejected — breaks
portability and the zero-knowledge story); defer without a record (rejected — the
feature was built then abandoned, which invites relitigating it).
