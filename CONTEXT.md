# MyNotes

Local-first, end-to-end encrypted markdown note-taking. One blank page; a session is a
single shared document holding all of a user's notes.

## Language

**Session**:
A single Yjs document holding all of a user's notes — the unit of persistence, routing,
and sharing.
_Avoid_: workspace, notebook, document

**Note**:
One markdown text within a session, listed in the sidebar.
_Avoid_: document, entry, page

**Room**:
The server-side storage and relay space for one session's encrypted Yjs updates.
_Avoid_: channel, space

**Edit token**:
The bearer capability that grants write access to a session.
_Avoid_: password, API key, secret

**Mark concealment**:
The rendering rule that hides markdown marks except on the cursor line; the document
always stores the raw marks.
_Avoid_: WYSIWYG, formatting

**Input rule**:
A typing trigger that transforms text into its markdown form with no visible UI.
_Avoid_: command, slash command

**Invisible ergonomics**:
The design principle that writing aids live in the keyboard and typing behavior, never
in added chrome.
_Avoid_: toolbar, feature set

**Preview**:
The read-only rendered view of a note's markdown.
_Avoid_: reading mode, rendered mode

**UX Backlog**:
The committed plan of record that autonomous UX runs consume and update.
_Avoid_: roadmap, TODO
