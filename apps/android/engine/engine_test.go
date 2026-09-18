package engine

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

func mustCreate(t *testing.T, s *SessionDoc, id string) *Text {
	t.Helper()
	if err := s.Notes().Create(id); err != nil {
		t.Fatalf("Create(%q): %v", id, err)
	}
	text := s.Notes().GetText(id)
	if text == nil {
		t.Fatalf("GetText(%q) = nil after create", id)
	}
	return text
}

func mustInsert(t *testing.T, text *Text, index int, value string) {
	t.Helper()
	if err := text.Insert(index, value); err != nil {
		t.Fatalf("Insert(%d, %q): %v", index, value, err)
	}
}

func mustDelete(t *testing.T, text *Text, index, length int) {
	t.Helper()
	if err := text.Delete(index, length); err != nil {
		t.Fatalf("Delete(%d, %d): %v", index, length, err)
	}
}

func noteIDs(t *testing.T, s *SessionDoc) []string {
	t.Helper()
	var ids []string
	if err := json.Unmarshal(s.Notes().ListIDsJSON(), &ids); err != nil {
		t.Fatalf("ListIDsJSON: %v", err)
	}
	sort.Strings(ids)
	return ids
}

func assertSameNotes(t *testing.T, a, b *SessionDoc) {
	t.Helper()
	if ia, ib := noteIDs(t, a), noteIDs(t, b); !reflect.DeepEqual(ia, ib) {
		t.Fatalf("note sets differ: %v vs %v", ia, ib)
	}
	for _, id := range noteIDs(t, a) {
		ta, tb := a.Notes().GetText(id), b.Notes().GetText(id)
		if ta == nil || tb == nil {
			t.Fatalf("note %q text handle missing: %v vs %v", id, ta, tb)
		}
		if ta.String() != tb.String() {
			t.Fatalf("note %q strings differ: %q vs %q", id, ta.String(), tb.String())
		}
		if ta.Length() != tb.Length() {
			t.Fatalf("note %q lengths differ: %d vs %d", id, ta.Length(), tb.Length())
		}
	}
}

func TestSessionDocRoundTrip(t *testing.T) {
	a := newSessionDocWithClientID(1)
	text := mustCreate(t, a, "n1")
	mustInsert(t, text, 0, "héllo 🎉")
	if got, want := text.String(), "héllo 🎉"; got != want {
		t.Fatalf("String() = %q, want %q", got, want)
	}
	if got, want := text.Length(), 8; got != want {
		t.Fatalf("Length() = %d, want %d", got, want)
	}

	b := newSessionDocWithClientID(2)
	if err := b.ApplyUpdate(a.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("full state apply: %v", err)
	}
	assertSameNotes(t, a, b)

	older := b.EncodeStateVector()
	mustInsert(t, text, 8, "!")
	diff, err := a.EncodeDiff(older)
	if err != nil {
		t.Fatalf("EncodeDiff: %v", err)
	}
	if err := b.ApplyUpdate(diff); err != nil {
		t.Fatalf("diff apply: %v", err)
	}
	assertSameNotes(t, a, b)

	c := newSessionDocWithClientID(3)
	full, err := a.EncodeDiff(nil)
	if err != nil {
		t.Fatalf("EncodeDiff(nil): %v", err)
	}
	if err := c.ApplyUpdate(full); err != nil {
		t.Fatalf("empty-vector diff apply: %v", err)
	}
	assertSameNotes(t, a, c)
}

func TestUTF16Indices(t *testing.T) {
	s := newSessionDocWithClientID(1)
	text := mustCreate(t, s, "n1")
	mustInsert(t, text, 0, "a🎉b")
	if got, want := text.Length(), 4; got != want {
		t.Fatalf("Length() = %d, want %d", got, want)
	}
	mustInsert(t, text, 3, "X")
	if got, want := text.String(), "a🎉Xb"; got != want {
		t.Fatalf("String() = %q, want %q", got, want)
	}
	mustDelete(t, text, 1, 2)
	if got, want := text.String(), "aXb"; got != want {
		t.Fatalf("String() = %q, want %q", got, want)
	}
	if got, want := text.Length(), 3; got != want {
		t.Fatalf("Length() = %d, want %d", got, want)
	}
}

func TestNotesCRUD(t *testing.T) {
	s := newSessionDocWithClientID(1)
	n := s.Notes()
	if got := n.Len(); got != 0 {
		t.Fatalf("Len() = %d, want 0", got)
	}
	if err := n.Create("n1"); err != nil {
		t.Fatalf("Create(n1): %v", err)
	}
	if err := n.Create("n2"); err != nil {
		t.Fatalf("Create(n2): %v", err)
	}
	if got := n.Len(); got != 2 {
		t.Fatalf("Len() = %d, want 2", got)
	}
	if !n.Has("n1") || !n.Has("n2") {
		t.Fatalf("Has() = false for a created note")
	}
	if n.GetText("n1") == nil {
		t.Fatalf("GetText(n1) = nil")
	}
	if ids := noteIDs(t, s); !reflect.DeepEqual(ids, []string{"n1", "n2"}) {
		t.Fatalf("ListIDsJSON = %v, want [n1 n2]", ids)
	}
	if n.GetText("missing") != nil {
		t.Fatalf("GetText(missing) != nil")
	}
	if err := n.Create("n2"); err == nil {
		t.Fatalf("duplicate Create(n2) succeeded")
	}
	if err := n.Create(""); err == nil {
		t.Fatalf("Create(\"\") succeeded")
	}
	if err := n.Delete("n1"); err != nil {
		t.Fatalf("Delete(n1): %v", err)
	}
	if n.Has("n1") {
		t.Fatalf("Has(n1) = true after delete")
	}
	if n.GetText("n1") != nil {
		t.Fatalf("GetText(n1) != nil after delete")
	}
	if err := n.Delete("n1"); err != nil {
		t.Fatalf("idempotent Delete(n1): %v", err)
	}
	if err := n.Delete(""); err == nil {
		t.Fatalf("Delete(\"\") succeeded")
	}
	if got := n.Len(); got != 1 {
		t.Fatalf("Len() = %d, want 1", got)
	}
	if ids := noteIDs(t, s); !reflect.DeepEqual(ids, []string{"n2"}) {
		t.Fatalf("ListIDsJSON = %v, want [n2]", ids)
	}
}

func TestInvalidRanges(t *testing.T) {
	s := newSessionDocWithClientID(1)
	text := mustCreate(t, s, "n1")
	mustInsert(t, text, 0, "abc")

	if err := text.Insert(-1, "x"); err == nil {
		t.Fatalf("Insert(-1) succeeded")
	}
	if err := text.Insert(4, "x"); err == nil {
		t.Fatalf("Insert(4) past end succeeded")
	}
	if err := text.Delete(-1, 1); err == nil {
		t.Fatalf("Delete(-1, 1) succeeded")
	}
	if err := text.Delete(0, -1); err == nil {
		t.Fatalf("Delete(0, -1) succeeded")
	}
	if err := text.Delete(2, 5); err == nil {
		t.Fatalf("Delete(2, 5) past end succeeded")
	}

	if got, want := text.String(), "abc"; got != want {
		t.Fatalf("String() = %q, want %q after invalid ops", got, want)
	}
	if got, want := text.Length(), 3; got != want {
		t.Fatalf("Length() = %d, want %d after invalid ops", got, want)
	}
}

func TestUndoLocalOnly(t *testing.T) {
	a := newSessionDocWithClientID(1)

	t1 := mustCreate(t, a, "n1")
	u1 := t1.NewUndo()
	mustInsert(t, t1, 0, "hello")
	u1.StopCapturing()
	if !u1.CanUndo() {
		t.Fatalf("CanUndo() = false after local insert")
	}
	if !u1.Undo() {
		t.Fatalf("Undo() = false with a captured step")
	}
	if got, want := t1.String(), ""; got != want {
		t.Fatalf("String() after undo = %q, want %q", got, want)
	}
	if !u1.CanRedo() {
		t.Fatalf("CanRedo() = false after undo")
	}
	if !u1.Redo() {
		t.Fatalf("Redo() = false with a redone step")
	}
	if got, want := t1.String(), "hello"; got != want {
		t.Fatalf("String() after redo = %q, want %q", got, want)
	}

	t2 := mustCreate(t, a, "n2")
	u2 := t2.NewUndo()
	mustInsert(t, t2, 0, "abc")
	u2.StopCapturing()

	b := newSessionDocWithClientID(2)
	if err := b.ApplyUpdate(a.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("seed remote doc: %v", err)
	}
	bt := b.Notes().GetText("n2")
	if bt == nil {
		t.Fatalf("remote GetText(n2) = nil")
	}
	mustInsert(t, bt, 3, "XYZ")

	if err := a.ApplyUpdate(b.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("remote apply: %v", err)
	}
	if got, want := t2.String(), "abcXYZ"; got != want {
		t.Fatalf("String() after remote apply = %q, want %q", got, want)
	}
	if !u2.CanUndo() {
		t.Fatalf("CanUndo() = false, local step lost")
	}
	if !u2.Undo() {
		t.Fatalf("Undo() = false with a captured local step")
	}
	if got, want := t2.String(), "XYZ"; got != want {
		t.Fatalf("String() after undo = %q, want %q (remote edit must survive)", got, want)
	}
	if u2.CanUndo() {
		t.Fatalf("CanUndo() = true: remote apply was captured")
	}
	if !u2.Redo() {
		t.Fatalf("Redo() = false after undo")
	}
	if got, want := t2.String(), "abcXYZ"; got != want {
		t.Fatalf("String() after redo = %q, want %q", got, want)
	}
}

func TestUndoCommandBoundaries(t *testing.T) {
	s := newSessionDocWithClientID(1)
	text := mustCreate(t, s, "n1")
	u := text.NewUndo()

	mustInsert(t, text, 0, "a")
	u.StopCapturing()
	mustInsert(t, text, 1, "b")
	if got, want := text.String(), "ab"; got != want {
		t.Fatalf("String() = %q, want %q", got, want)
	}
	if !u.CanUndo() {
		t.Fatalf("CanUndo() = false")
	}
	if !u.Undo() {
		t.Fatalf("first Undo() = false")
	}
	if got, want := text.String(), "a"; got != want {
		t.Fatalf("String() after first undo = %q, want %q", got, want)
	}
	if !u.CanUndo() {
		t.Fatalf("CanUndo() = false: StopCapturing did not create a second step")
	}
	if !u.Undo() {
		t.Fatalf("second Undo() = false")
	}
	if got, want := text.String(), ""; got != want {
		t.Fatalf("String() after second undo = %q, want %q", got, want)
	}
	if u.CanUndo() {
		t.Fatalf("CanUndo() = true after both steps undone")
	}
}

func TestUndoPerNoteIsolation(t *testing.T) {
	s := newSessionDocWithClientID(1)
	ta := mustCreate(t, s, "a")
	tb := mustCreate(t, s, "b")

	mustInsert(t, tb, 0, "keep")
	ub := tb.NewUndo()
	ua := ta.NewUndo()
	mustInsert(t, ta, 0, "x")

	if !ua.CanUndo() {
		t.Fatalf("note A CanUndo() = false after edit")
	}
	if ub.CanUndo() {
		t.Fatalf("note B CanUndo() = true without an edit")
	}
	if !ua.Undo() {
		t.Fatalf("note A Undo() = false")
	}
	if got, want := ta.String(), ""; got != want {
		t.Fatalf("note A String() = %q, want %q", got, want)
	}
	if got, want := tb.String(), "keep"; got != want {
		t.Fatalf("note B String() = %q, want %q", got, want)
	}
}

func TestUndoNoteDeletion(t *testing.T) {
	s := newSessionDocWithClientID(1)
	text := mustCreate(t, s, "n1")
	u := text.NewUndo()
	mustInsert(t, text, 0, "hello")
	if !u.CanUndo() {
		t.Fatalf("CanUndo() = false after edit")
	}

	if err := s.Notes().Delete("n1"); err != nil {
		t.Fatalf("Delete(n1): %v", err)
	}
	if s.Notes().Has("n1") {
		t.Fatalf("Has(n1) = true after delete")
	}

	if !u.Undo() {
		t.Fatalf("Undo() = false after note deletion")
	}
	if s.Notes().Has("n1") {
		t.Fatalf("undo resurrected the deleted map key")
	}
	// The detached text branch stays readable; the map key lives on the
	// out-of-scope notes map, so the undo manager never tracks it.
	if got, want := text.String(), "hello"; got != want {
		t.Fatalf("detached text String() = %q, want %q", got, want)
	}

	u.Close()
	u.Close()
	if u.Undo() {
		t.Fatalf("Undo() = true after Close")
	}
}

func TestLastChangeWasRemote(t *testing.T) {
	s := newSessionDocWithClientID(1)
	if s.LastChangeWasRemote() {
		t.Fatalf("LastChangeWasRemote() = true before any change")
	}
	text := mustCreate(t, s, "n1")
	mustInsert(t, text, 0, "hi")
	if s.LastChangeWasRemote() {
		t.Fatalf("LastChangeWasRemote() = true after local edit")
	}

	b := newSessionDocWithClientID(2)
	if err := b.ApplyUpdate(s.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("seed remote: %v", err)
	}
	bt := b.Notes().GetText("n1")
	if bt == nil {
		t.Fatalf("remote GetText(n1) = nil")
	}
	mustInsert(t, bt, 2, " there")

	if err := s.ApplyUpdate(b.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("remote apply: %v", err)
	}
	if !s.LastChangeWasRemote() {
		t.Fatalf("LastChangeWasRemote() = false after remote apply")
	}

	mustInsert(t, text, 0, "hey ")
	if s.LastChangeWasRemote() {
		t.Fatalf("LastChangeWasRemote() = true after local edit")
	}
}

func TestRemoteApplyConverges(t *testing.T) {
	a := newSessionDocWithClientID(1)
	ta := mustCreate(t, a, "n1")
	mustInsert(t, ta, 0, "alpha")
	tb := mustCreate(t, a, "n2")
	mustInsert(t, tb, 0, "βeta 🎉")

	b := newSessionDocWithClientID(2)
	diff, err := a.EncodeDiff(b.EncodeStateVector())
	if err != nil {
		t.Fatalf("EncodeDiff: %v", err)
	}
	if err := b.ApplyUpdate(diff); err != nil {
		t.Fatalf("diff apply: %v", err)
	}
	assertSameNotes(t, a, b)

	if err := b.ApplyUpdate(diff); err != nil {
		t.Fatalf("re-apply same diff: %v", err)
	}
	assertSameNotes(t, a, b)
}
