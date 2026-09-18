package engine

import (
	"bytes"
	"testing"
)

func TestSequentialEnqueueDiffs(t *testing.T) {
	a := newSessionDocWithClientID(11)
	b := newSessionDocWithClientID(12)

	// enqueue simulates one relay outbox flush: snapshot A's state vector,
	// apply exactly one local round, encode the delta for B, and integrate it.
	enqueue := func(label string, mutate func()) {
		t.Helper()
		sv := a.EncodeStateVector()
		mutate()
		diff, err := a.EncodeDiff(sv)
		if err != nil {
			t.Fatalf("%s: EncodeDiff: %v", label, err)
		}
		if len(diff) == 0 {
			t.Fatalf("%s: diff is empty after a mutation", label)
		}
		if err := b.ApplyUpdate(diff); err != nil {
			t.Fatalf("%s: ApplyUpdate: %v", label, err)
		}
		assertSameNotes(t, a, b)
	}

	enqueue("create note", func() {
		mustCreate(t, a, "n1")
		mustInsert(t, a.Notes().GetText("n1"), 0, "hello")
	})
	enqueue("insert", func() {
		mustInsert(t, a.Notes().GetText("n1"), 5, " world")
	})
	enqueue("delete range", func() {
		mustDelete(t, a.Notes().GetText("n1"), 0, 5)
	})
	enqueue("create second note", func() {
		mustCreate(t, a, "n2")
		mustInsert(t, a.Notes().GetText("n2"), 0, "second")
	})
	enqueue("map delete", func() {
		if err := a.Notes().Delete("n2"); err != nil {
			t.Fatalf("Delete(n2): %v", err)
		}
	})

	if got, want := a.Notes().GetText("n1").String(), " world"; got != want {
		t.Fatalf("note n1 = %q, want %q", got, want)
	}
	if a.Notes().Has("n2") {
		t.Fatalf("note n2 still present after map delete")
	}
}

func TestRemoteApplyAndDuplicates(t *testing.T) {
	a := newSessionDocWithClientID(11)
	ta := mustCreate(t, a, "n1")
	mustInsert(t, ta, 0, "alpha")

	b := newSessionDocWithClientID(12)
	full := a.EncodeStateAsUpdate()
	if err := b.ApplyUpdate(full); err != nil {
		t.Fatalf("first full apply: %v", err)
	}
	if err := b.ApplyUpdate(full); err != nil {
		t.Fatalf("duplicate full apply: %v", err)
	}
	assertSameNotes(t, a, b)

	tb := b.Notes().GetText("n1")
	if tb == nil {
		t.Fatalf("GetText(n1) = nil on B")
	}
	mustInsert(t, tb, 5, " beta")
	diff, err := b.EncodeDiff(a.EncodeStateVector())
	if err != nil {
		t.Fatalf("EncodeDiff: %v", err)
	}
	if len(diff) == 0 {
		t.Fatalf("B's edit produced an empty diff")
	}
	if err := a.ApplyUpdate(diff); err != nil {
		t.Fatalf("A applies B's diff: %v", err)
	}
	assertSameNotes(t, a, b)
	if got, want := a.Notes().GetText("n1").String(), "alpha beta"; got != want {
		t.Fatalf("converged n1 = %q, want %q", got, want)
	}
}

func TestDeletionOnlyDiff(t *testing.T) {
	a := newSessionDocWithClientID(11)
	ta := mustCreate(t, a, "n1")
	mustInsert(t, ta, 0, "abcdef")

	b := newSessionDocWithClientID(12)
	if err := b.ApplyUpdate(a.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("seed B: %v", err)
	}
	assertSameNotes(t, a, b)

	stale := a.EncodeStateVector()
	mustDelete(t, ta, 1, 3)
	diff, err := a.EncodeDiff(stale)
	if err != nil {
		t.Fatalf("EncodeDiff(stale): %v", err)
	}
	if len(diff) == 0 {
		t.Fatalf("deletion-only diff is empty")
	}
	if err := b.ApplyUpdate(diff); err != nil {
		t.Fatalf("B applies deletion diff: %v", err)
	}
	assertSameNotes(t, a, b)
	if got, want := b.Notes().GetText("n1").String(), "aef"; got != want {
		t.Fatalf("B note = %q, want %q", got, want)
	}

	// Re-applying B's full state on A must be a no-op.
	before := a.Notes().GetText("n1").String()
	if err := a.ApplyUpdate(b.EncodeStateAsUpdate()); err != nil {
		t.Fatalf("A re-applies B's full state: %v", err)
	}
	if got := a.Notes().GetText("n1").String(); got != before {
		t.Fatalf("A changed after re-applying B's full state: %q -> %q", before, got)
	}
	assertSameNotes(t, a, b)
}

func TestRestartReconstruction(t *testing.T) {
	a := newSessionDocWithClientID(11)
	t1 := mustCreate(t, a, "n1")
	mustInsert(t, t1, 0, "one 🎉")
	t2 := mustCreate(t, a, "n2")
	mustInsert(t, t2, 0, "two")
	mustDelete(t, t2, 1, 1)
	mustCreate(t, a, "n3")
	mustInsert(t, a.Notes().GetText("n3"), 0, "three")

	full := a.EncodeStateAsUpdate()

	c := newSessionDocWithClientID(13)
	if err := c.ApplyUpdate(full); err != nil {
		t.Fatalf("C applies A's full state: %v", err)
	}
	assertSameNotes(t, a, c)
	if got, want := c.EncodeStateVector(), a.EncodeStateVector(); !bytes.Equal(got, want) {
		t.Fatalf("reconstructed C state vector %x != A %x", got, want)
	}
}

func TestOutboxReplayIsIdempotent(t *testing.T) {
	a := newSessionDocWithClientID(11)
	ta := mustCreate(t, a, "n1")
	mustInsert(t, ta, 0, "hello")

	b := newSessionDocWithClientID(12)
	diff, err := a.EncodeDiff(b.EncodeStateVector())
	if err != nil {
		t.Fatalf("EncodeDiff: %v", err)
	}
	if err := b.ApplyUpdate(diff); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	beforeSV := append([]byte(nil), b.EncodeStateVector()...)
	beforeText := b.Notes().GetText("n1").String()

	if err := b.ApplyUpdate(diff); err != nil {
		t.Fatalf("replay apply: %v", err)
	}
	if got := b.EncodeStateVector(); !bytes.Equal(got, beforeSV) {
		t.Fatalf("state vector changed on replay: %x -> %x", beforeSV, got)
	}
	if got := b.Notes().GetText("n1").String(); got != beforeText {
		t.Fatalf("note changed on replay: %q -> %q", beforeText, got)
	}
	assertSameNotes(t, a, b)
}
