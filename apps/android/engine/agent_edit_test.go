package engine

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

type anchorJSON struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

func TestApplyEditsJSONAppliesBatchAndReturnsAnchors(t *testing.T) {
	s := NewSessionDoc()
	if err := s.Notes().Create("n1"); err != nil {
		t.Fatal(err)
	}
	text := s.Notes().GetText("n1")
	if err := text.Insert(0, "one two three"); err != nil {
		t.Fatal(err)
	}
	raw, err := text.ApplyEditsJSON([]byte(`[{"from":0,"to":3,"expected":"one","replacement":"1"},{"from":8,"to":13,"expected":"three","replacement":"3"}]`))
	if err != nil {
		t.Fatal(err)
	}
	if got := text.String(); got != "1 two 3" {
		t.Fatalf("got %q", got)
	}
	var anchors []anchorJSON
	if err := json.Unmarshal(raw, &anchors); err != nil {
		t.Fatal(err)
	}
	if len(anchors) != 2 {
		t.Fatalf("expected 2 anchors, got %d", len(anchors))
	}
	start, err := base64.RawURLEncoding.DecodeString(anchors[0].Start)
	if err != nil {
		t.Fatal(err)
	}
	index, err := text.ResolveAnchor(start)
	if err != nil {
		t.Fatal(err)
	}
	if index != 0 {
		t.Fatalf("expected start anchor at 0, got %d", index)
	}
	end, err := base64.RawURLEncoding.DecodeString(anchors[0].End)
	if err != nil {
		t.Fatal(err)
	}
	resolvedEnd, err := text.ResolveAnchor(end)
	if err != nil {
		t.Fatal(err)
	}
	if resolvedEnd != 1 {
		t.Fatalf("expected end anchor at 1, got %d", resolvedEnd)
	}
}

func TestApplyEditsJSONRejectsBeforeMutation(t *testing.T) {
	s := NewSessionDoc()
	if err := s.Notes().Create("n1"); err != nil {
		t.Fatal(err)
	}
	text := s.Notes().GetText("n1")
	if err := text.Insert(0, "hello"); err != nil {
		t.Fatal(err)
	}
	cases := []string{
		`[{"from":0,"to":5,"expected":"nope","replacement":"x"}]`,
		`[{"from":3,"to":2,"expected":"","replacement":"x"}]`,
		`[{"from":0,"to":99,"expected":"hello","replacement":"x"}]`,
		`[{"from":0,"to":3,"expected":"hel","replacement":"x"},{"from":2,"to":4,"expected":"ll","replacement":"y"}]`,
	}
	for _, payload := range cases {
		if _, err := text.ApplyEditsJSON([]byte(payload)); err == nil {
			t.Fatalf("expected error for %s", payload)
		}
	}
	if got := text.String(); got != "hello" {
		t.Fatalf("document changed: %q", got)
	}
}

func TestApplyEditsJSONRejectsSurrogateSplit(t *testing.T) {
	s := NewSessionDoc()
	if err := s.Notes().Create("n1"); err != nil {
		t.Fatal(err)
	}
	text := s.Notes().GetText("n1")
	if err := text.Insert(0, "a😀b"); err != nil {
		t.Fatal(err)
	}
	_, err := text.ApplyEditsJSON([]byte(`[{"from":2,"to":3,"expected":"\ud83d","replacement":"x"}]`))
	if err == nil || !strings.Contains(err.Error(), "surrogate") {
		t.Fatalf("expected surrogate error, got %v", err)
	}
}

func TestAnchorsFollowRemoteInsertsBeforeTheRange(t *testing.T) {
	first := NewSessionDoc()
	if err := first.Notes().Create("n1"); err != nil {
		t.Fatal(err)
	}
	text := first.Notes().GetText("n1")
	if err := text.Insert(0, "hello world"); err != nil {
		t.Fatal(err)
	}
	raw, err := text.ApplyEditsJSON([]byte(`[{"from":0,"to":5,"expected":"hello","replacement":"goodbye"}]`))
	if err != nil {
		t.Fatal(err)
	}
	var anchors []anchorJSON
	if err := json.Unmarshal(raw, &anchors); err != nil {
		t.Fatal(err)
	}
	end, err := base64.RawURLEncoding.DecodeString(anchors[0].End)
	if err != nil {
		t.Fatal(err)
	}

	second := newSessionDocWithClientID(99)
	if err := second.ApplyUpdate(first.EncodeStateAsUpdate()); err != nil {
		t.Fatal(err)
	}
	remote := second.Notes().GetText("n1")
	if err := remote.Insert(0, ">> "); err != nil {
		t.Fatal(err)
	}
	if err := first.ApplyUpdate(second.EncodeStateAsUpdate()); err != nil {
		t.Fatal(err)
	}
	index, err := text.ResolveAnchor(end)
	if err != nil {
		t.Fatal(err)
	}
	if index != 10 {
		t.Fatalf("expected anchor to shift to 10, got %d", index)
	}
	if got := text.String(); got != ">> goodbye world" {
		t.Fatalf("unexpected text %q", got)
	}
}
