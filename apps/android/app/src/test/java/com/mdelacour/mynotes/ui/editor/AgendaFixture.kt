package com.mdelacour.mynotes.ui.editor

object AgendaFixture {
	val note: String = """
		|# Agenda
		|
		|## Frid Sept 11
		|
		|**Goal:** ship the fix and close the episode.
		|
		|- [ ] Faire les comptes avant que Monarch soit renew
		|- [ ] Call the accountant back
		|- [x] Review the open pull request
		|- [ ] Faire les comptes avant que Monarch soit renew
		|- [ ] Draft the release notes
		|- [ ] Verify the preview build
		|- [ ] Update the changelog
		|- [ ] Close the review
		|
		|## Thurs Sept 10
		|
		|**Goal:** triage the backlog before the sprint starts.
		|
		|- [ ] Triage the inbox
		|- [x] Archive the old notes
		|- [ ] Plan the next sprint
		|- [ ] Book the meeting room
		|
		|A prose paragraph that must survive rendering without becoming a task row.
		|
		|- first bullet item
		|- second bullet item
		|
		|```
		|- [ ] not a task
		|```
	""".trimMargin()

	val manyTasks: String = buildString {
		append("# Many tasks\n\n")
		for (index in 1..40) {
			append("- [ ] Task number $index\n")
		}
	}
}
