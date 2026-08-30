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

**Library**:
The home page listing every session the user owns or has subscribed to, with
open, delete, and new-session actions.
_Avoid_: dashboard, home, note list

**Owned session**:
A session the user can edit and sync — created locally or added to the
library with an edit token.
_Avoid_: local session, primary session

**Subscribed session**:
A session the user added to the library from a view-only share link; readable
offline but never synced from the user's client.
_Avoid_: follower, watched session

**Pending edits**:
Local Yjs updates made without a live connection, held in a per-room outbox
until a snapshot compaction succeeds.
_Avoid_: queue, dirty state, backlog

**UX Backlog**:
The committed plan of record that autonomous UX runs consume and update.
_Avoid_: roadmap, TODO
