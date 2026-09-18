package engine

import "testing"

func TestUndoRemoteExclusion(t *testing.T) {
	a := newSessionDocWithClientID(11)
	ta := mustCreate(t, a, "n1")
	u := ta.NewUndo()

	if u.CanUndo() {
		t.Fatalf("CanUndo() = true before any edit")
	}

	b := newSessionDocWithClientID(12)
	if err := b.ApplyUpdate(a.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("seed B: %v", err)
	}
	bt := b.Notes().GetText("n1")
	if bt == nil {
		t.Fatalf("GetText(n1) = nil on B")
	}
	mustInsert(t, bt, 0, "remote ")

	if err := a.ApplyUpdate(b.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("A applies remote edit: %v", err)
	}
	if u.CanUndo() {
		t.Fatalf("CanUndo() = true after a remote apply")
	}
	if got, want := ta.String(), "remote "; got != want {
		t.Fatalf("remote text = %q, want %q", got, want)
	}

	mustInsert(t, ta, 7, "local")
	u.StopCapturing()
	if !u.CanUndo() {
		t.Fatalf("CanUndo() = false after a local edit")
	}
	if !u.Undo() {
		t.Fatalf("Undo() = false with a captured local step")
	}
	if got, want := ta.String(), "remote "; got != want {
		t.Fatalf("after undo text = %q, want %q (remote content must survive)", got, want)
	}
	if u.CanUndo() {
		t.Fatalf("CanUndo() = true after undoing the only local step")
	}
}

func TestUndoNoteDeletionClosesCleanly(t *testing.T) {
	s := newSessionDocWithClientID(11)
	text := mustCreate(t, s, "n1")
	u := text.NewUndo()
	mustInsert(t, text, 0, "hello")
	u.Close()

	if err := s.Notes().Delete("n1"); err != nil {
		t.Fatalf("Delete(n1): %v", err)
	}
	if s.Notes().Has("n1") {
		t.Fatalf("Has(n1) = true after delete")
	}

	// A manager left open when its note is deleted must not resurrect the
	// map key. Observed ygo GC semantics: deleting the map entry GCs the
	// nested text, so the stale manager's undo replays against the detached
	// branch and becomes a no-op on the live map.
	s2 := newSessionDocWithClientID(12)
	text2 := mustCreate(t, s2, "n1")
	u2 := text2.NewUndo()
	mustInsert(t, text2, 0, "hello")
	if err := s2.Notes().Delete("n1"); err != nil {
		t.Fatalf("Delete(n1) on s2: %v", err)
	}
	u2.Undo()
	if s2.Notes().Has("n1") {
		t.Fatalf("open manager's Undo() resurrected the deleted map key")
	}
	u2.Close()
	u2.Close()
}

func TestUndoCleanupAfterDelete(t *testing.T) {
	s := newSessionDocWithClientID(11)
	text := mustCreate(t, s, "n1")
	u := text.NewUndo()
	mustInsert(t, text, 0, "hello")
	if !u.CanUndo() {
		t.Fatalf("CanUndo() = false after local edit")
	}

	if err := s.Notes().Delete("n1"); err != nil {
		t.Fatalf("Delete(n1): %v", err)
	}
	u.Close()

	if u.Undo() {
		t.Fatalf("Undo() = true after Delete + Close")
	}
	if u.CanUndo() {
		t.Fatalf("CanUndo() = true after Delete + Close")
	}
	if u.CanRedo() {
		t.Fatalf("CanRedo() = true after Delete + Close")
	}
}
