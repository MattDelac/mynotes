// Package engine is a thin, gomobile-bindable facade over the root
// github.com/Deln0r/ygo package for the MyNotes Android app.
//
// The bind surface is deliberately restricted to the types gomobile can
// generate bindings for: basic scalars, []byte, string, error, and
// opaque struct pointers with unexported fields. In particular there are
// no []string returns, no uint64, no maps, and no callbacks.
//
// A SessionDoc owns exactly one ygo.Doc. Every note lives in the root
// Y.Map named "notes" as a Y.Text value, matching the web client's
// session model. Every mutation initiated through this facade commits a
// write transaction tagged with localOrigin, so an undo manager created
// by NewUndo captures only local edits; updates integrated through
// ApplyUpdate keep ygo's nil origin and are therefore never captured.
package engine

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"unicode/utf16"

	"github.com/Deln0r/ygo"
)

// localOrigin tags every transaction opened by a binding mutator. NewUndo
// configures the undo manager with exactly this origin as its tracked set,
// so local edits are captured while remote updates (nil origin, applied by
// ApplyUpdate) are not.
const localOrigin = "mynotes:local"

// SessionDoc is the gomobile-bindable handle for one MyNotes session: a
// single CRDT document holding every note. Construct it with NewSessionDoc;
// all methods are safe to call from the Java/Kotlin thread that owns it.
type SessionDoc struct {
	doc      *ygo.Doc
	notesMap *ygo.Map
	notes    *Notes

	// lastRemote mirrors whether the most recently committed transaction
	// had a nil origin. The OnAfterTransaction handler runs under the doc
	// write lock while this field is read from Java threads, so it is
	// accessed atomically.
	lastRemote atomic.Bool
}

// NewSessionDoc returns a fresh session document with a random ygo client
// identifier.
func NewSessionDoc() *SessionDoc {
	return newSessionDoc(ygo.NewDoc())
}

// newSessionDocWithClientID returns a session document with a fixed client
// identifier. It exists so tests can build deterministic replicas;
// production code uses NewSessionDoc.
func newSessionDocWithClientID(clientID uint64) *SessionDoc {
	return newSessionDoc(ygo.NewDocWithOptions(ygo.Options{ClientID: clientID}))
}

// newSessionDoc wires the shared handles and the change-origin observer
// onto an already-constructed ygo document.
func newSessionDoc(doc *ygo.Doc) *SessionDoc {
	s := &SessionDoc{doc: doc}
	s.notesMap = ygo.NewMap(doc, "notes")
	s.notes = &Notes{session: s}
	doc.OnAfterTransaction(func(txn *ygo.TransactionMut) {
		s.lastRemote.Store(txn.Origin == nil)
	})
	return s
}

// ApplyUpdate integrates a remote Yjs update exactly as received from the
// relay. It is the only nil-origin entry point in this binding.
func (s *SessionDoc) ApplyUpdate(update []byte) error {
	return ygo.ApplyUpdate(s.doc, update)
}

// EncodeStateAsUpdate returns the full document state as a V1 Yjs update,
// byte-compatible with the web client.
func (s *SessionDoc) EncodeStateAsUpdate() []byte {
	return ygo.EncodeStateAsUpdate(s.doc)
}

// EncodeStateVector returns the V1 state vector, used as the sync-protocol
// SyncStep1 payload and as the argument to EncodeDiff.
func (s *SessionDoc) EncodeStateVector() []byte {
	return ygo.EncodeStateVector(s.doc)
}

// EncodeDiff returns the update carrying the blocks the peer at stateVector
// is missing.
func (s *SessionDoc) EncodeDiff(stateVector []byte) ([]byte, error) {
	return ygo.EncodeDiff(s.doc, stateVector)
}

// Notes returns the handle over the session's note map.
func (s *SessionDoc) Notes() *Notes { return s.notes }

// LastChangeWasRemote reports whether the most recently committed
// transaction had a nil origin, meaning it came from ApplyUpdate rather
// than from a binding mutator. It is false before any change.
func (s *SessionDoc) LastChangeWasRemote() bool { return s.lastRemote.Load() }

// Notes is the gomobile-bindable handle over the session's Y.Map of note
// IDs to Y.Text bodies.
type Notes struct {
	session *SessionDoc
}

// ListIDsJSON returns the live note IDs as a JSON array of strings.
// gomobile cannot bind []string returns, so the IDs travel as JSON. The
// order is unspecified.
func (n *Notes) ListIDsJSON() []byte {
	txn := n.session.doc.ReadTxn()
	defer txn.Close()
	ids := make([]string, 0, n.session.notesMap.Len())
	n.session.notesMap.Range(func(id string, _ any) bool {
		ids = append(ids, id)
		return true
	})
	b, _ := json.Marshal(ids)
	return b
}

// Len returns the number of live notes.
func (n *Notes) Len() int {
	txn := n.session.doc.ReadTxn()
	defer txn.Close()
	return n.session.notesMap.Len()
}

// Has reports whether a live note with the given ID exists.
func (n *Notes) Has(id string) bool {
	if id == "" {
		return false
	}
	txn := n.session.doc.ReadTxn()
	defer txn.Close()
	return n.session.notesMap.Has(id)
}

// Create creates an empty Y.Text note under id. It errors on an empty id or
// when a live note with id already exists.
func (n *Notes) Create(id string) error {
	if id == "" {
		return fmt.Errorf("engine: note id must not be empty")
	}
	doc := n.session.doc
	txn := doc.WriteTxn()
	txn.Origin = localOrigin
	defer txn.Commit()
	if n.session.notesMap.Has(id) {
		return fmt.Errorf("engine: note %q already exists", id)
	}
	n.session.notesMap.SetText(txn, id)
	return nil
}

// Delete tombstones the note under id. It errors on an empty id and is
// idempotent: deleting an absent note is a no-op that returns nil.
func (n *Notes) Delete(id string) error {
	if id == "" {
		return fmt.Errorf("engine: note id must not be empty")
	}
	doc := n.session.doc
	txn := doc.WriteTxn()
	txn.Origin = localOrigin
	defer txn.Commit()
	if !n.session.notesMap.Has(id) {
		return nil
	}
	n.session.notesMap.Delete(txn, id)
	return nil
}

// GetText returns the Y.Text body of the note under id, or nil when the
// note is absent or does not hold a text. The returned handle stays
// readable after the note is deleted (the branch is detached but live), but
// callers must re-fetch through Notes after session changes rather than
// caching it.
func (n *Notes) GetText(id string) *Text {
	if id == "" {
		return nil
	}
	txn := n.session.doc.ReadTxn()
	defer txn.Close()
	v := n.session.notesMap.Get(id)
	if v == nil {
		return nil
	}
	text, ok := v.(*ygo.Text)
	if !ok || text == nil {
		return nil
	}
	return &Text{session: n.session, text: text}
}

// Text is the gomobile-bindable handle over one note's Y.Text body. Indexes
// and lengths are UTF-16 code units, matching Yjs and the web client.
type Text struct {
	session *SessionDoc
	text    *ygo.Text
}

// Length returns the number of UTF-16 code units in the note.
func (t *Text) Length() int {
	txn := t.session.doc.ReadTxn()
	defer txn.Close()
	return int(t.text.Length())
}

// String returns the note's current plain text.
func (t *Text) String() string {
	txn := t.session.doc.ReadTxn()
	defer txn.Close()
	return t.text.String()
}

// Insert inserts value at the UTF-16 code-unit index. It errors if index is
// negative or greater than the current length.
func (t *Text) Insert(index int, value string) error {
	if index < 0 {
		return fmt.Errorf("engine: insert index %d is negative", index)
	}
	doc := t.session.doc
	txn := doc.WriteTxn()
	txn.Origin = localOrigin
	defer txn.Commit()
	total := int(t.text.Length())
	if index > total {
		return fmt.Errorf("engine: insert index %d out of range [0, %d]", index, total)
	}
	if value == "" {
		return nil
	}
	return t.text.Insert(txn, uint64(index), value)
}

// Delete removes length UTF-16 code units starting at index. It errors if
// either argument is negative or the range exceeds the current length.
func (t *Text) Delete(index int, length int) error {
	if index < 0 || length < 0 {
		return fmt.Errorf("engine: delete index %d and length %d must not be negative", index, length)
	}
	doc := t.session.doc
	txn := doc.WriteTxn()
	txn.Origin = localOrigin
	defer txn.Commit()
	total := int(t.text.Length())
	if index > total || length > total-index {
		return fmt.Errorf("engine: delete range [%d, %d) exceeds length %d", index, index+length, total)
	}
	if length == 0 {
		return nil
	}
	return t.text.Delete(txn, uint64(index), uint64(length))
}

// NewUndo returns a per-note undo manager that captures only edits made
// through this binding and never remote applies.
func (t *Text) NewUndo() *Undo {
	manager := ygo.NewUndoManagerWithOptions(t.session.doc, ygo.UndoManagerOptions{
		TrackedOrigins: map[any]struct{}{localOrigin: {}},
	}, t.text)
	return &Undo{manager: manager}
}

// ApplyEditsJSON applies a batch of UTF-16 range replacements in one
// local-origin transaction and returns the relative anchors for every
// replaced range as a JSON array of {start,end} base64url strings. Every
// edit is validated against the live text before the transaction opens, so
// a rejected batch leaves the document untouched. The JSON shape is an
// array of {from,to,expected,replacement} objects; edits must be sorted and
// non-overlapping.
func (t *Text) ApplyEditsJSON(editsJSON []byte) ([]byte, error) {
	type edit struct {
		From        int    `json:"from"`
		To          int    `json:"to"`
		Expected    string `json:"expected"`
		Replacement string `json:"replacement"`
	}
	type anchorPair struct {
		Start string `json:"start"`
		End   string `json:"end"`
	}
	var edits []edit
	if err := json.Unmarshal(editsJSON, &edits); err != nil {
		return nil, fmt.Errorf("engine: invalid edits: %w", err)
	}
	if len(edits) == 0 {
		return nil, fmt.Errorf("engine: edits must not be empty")
	}
	readTxn := t.session.doc.ReadTxn()
	current := t.text.String()
	readTxn.Close()
	units := utf16.Encode([]rune(current))
	previousTo := -1
	for _, e := range edits {
		if e.From < 0 || e.To < e.From || e.To > len(units) {
			return nil, fmt.Errorf("engine: edit range [%d, %d) is out of bounds", e.From, e.To)
		}
		if e.From < previousTo {
			return nil, fmt.Errorf("engine: edit ranges overlap")
		}
		if !validBoundary(units, e.From) || !validBoundary(units, e.To) {
			return nil, fmt.Errorf("engine: edit range splits a surrogate pair")
		}
		if string(utf16.Decode(units[e.From:e.To])) != e.Expected {
			return nil, fmt.Errorf("engine: expected text does not match the current note")
		}
		previousTo = e.To
	}
	anchors := make([]anchorPair, len(edits))
	for i, e := range edits {
		start, err := anchorBytes(t.text, e.From)
		if err != nil {
			return nil, err
		}
		end, err := anchorBytes(t.text, e.To)
		if err != nil {
			return nil, err
		}
		anchors[i] = anchorPair{Start: start, End: end}
	}
	doc := t.session.doc
	txn := doc.WriteTxn()
	txn.Origin = localOrigin
	defer txn.Commit()
	for i := len(edits) - 1; i >= 0; i-- {
		e := edits[i]
		if err := t.text.Delete(txn, uint64(e.From), uint64(e.To-e.From)); err != nil {
			return nil, err
		}
		if e.Replacement != "" {
			if err := t.text.Insert(txn, uint64(e.From), e.Replacement); err != nil {
				return nil, err
			}
		}
	}
	return json.Marshal(anchors)
}

func anchorBytes(text *ygo.Text, index int) (string, error) {
	rpos, err := ygo.CreateRelativePositionFromTypeIndex(text, uint64(index), 0)
	if err != nil {
		return "", err
	}
	encoded, err := ygo.EncodeRelativePosition(rpos)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func validBoundary(units []uint16, index int) bool {
	if index <= 0 || index >= len(units) {
		return true
	}
	before := units[index-1]
	at := units[index]
	return !(before >= 0xD800 && before <= 0xDBFF && at >= 0xDC00 && at <= 0xDFFF)
}

// CreateAnchor encodes a relative position for a UTF-16 index using the
// yjs-compatible binary form. assoc >= 0 sticks to the character after the
// position; assoc < 0 sticks to the character before it.
func (t *Text) CreateAnchor(index int, assoc int) ([]byte, error) {
	if index < 0 {
		return nil, fmt.Errorf("engine: anchor index %d is negative", index)
	}
	rpos, err := ygo.CreateRelativePositionFromTypeIndex(t.text, uint64(index), int64(assoc))
	if err != nil {
		return nil, err
	}
	return ygo.EncodeRelativePosition(rpos)
}

// ResolveAnchor resolves a relative position to the current UTF-16 index,
// or -1 when the anchor cannot be resolved against this replica.
func (t *Text) ResolveAnchor(anchor []byte) (int, error) {
	rpos, err := ygo.DecodeRelativePosition(anchor)
	if err != nil {
		return -1, err
	}
	absolute, ok := ygo.CreateAbsolutePositionFromRelativePosition(t.session.doc, rpos)
	if !ok {
		return -1, nil
	}
	return int(absolute.Index), nil
}

// Undo is a per-note undo/redo manager. Create one with Text.NewUndo and
// close it with Close when the note view is disposed.
type Undo struct {
	manager *ygo.UndoManager
}

// Undo reverts the most recent captured step, reporting whether one was
// applied.
func (u *Undo) Undo() bool { return u.manager.Undo() }

// Redo reapplies the most recently undone step, reporting whether one was
// applied.
func (u *Undo) Redo() bool { return u.manager.Redo() }

// CanUndo reports whether there is a captured step to revert.
func (u *Undo) CanUndo() bool { return u.manager.CanUndo() }

// CanRedo reports whether there is an undone step to reapply.
func (u *Undo) CanRedo() bool { return u.manager.CanRedo() }

// StopCapturing closes the current capture window so the next edit starts a
// new undo step.
func (u *Undo) StopCapturing() { u.manager.StopCapturing() }

// Close unregisters the manager. It is safe to call more than once.
func (u *Undo) Close() { u.manager.Close() }
