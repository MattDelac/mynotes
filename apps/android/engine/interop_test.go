package engine

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

const (
	fixtureNoteA = "11111111-1111-4111-8111-111111111111"
	fixtureNoteB = "22222222-2222-4222-8222-222222222222"
	fixtureNoteC = "33333333-3333-4333-8333-333333333333"
	fixtureNoteD = "44444444-4444-4444-8444-444444444444"
	fixtureNoteE = "55555555-5555-4555-8555-555555555555"
)

type fixtureNote struct {
	Text        string `json:"text"`
	UTF16Length int    `json:"utf16Length"`
}

type fixtureStage struct {
	Name    string                 `json:"name"`
	Updates []string               `json:"updates"`
	IDs     []string               `json:"ids"`
	Notes   map[string]fixtureNote `json:"notes"`
}

type fixtureManifest struct {
	YjsVersion string         `json:"yjsVersion"`
	Stages     []fixtureStage `json:"stages"`
}

func loadManifest(t *testing.T) fixtureManifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "manifest.json"))
	if err != nil {
		t.Fatalf("read testdata/manifest.json: %v (run node fixtures/generate.mjs)", err)
	}
	var manifest fixtureManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse testdata/manifest.json: %v", err)
	}
	return manifest
}

// applyFixtureFile applies one committed fixture update to doc.
func applyFixtureFile(t *testing.T, doc *SessionDoc, name string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read testdata/%s: %v (run node fixtures/generate.mjs)", name, err)
	}
	if err := doc.ApplyUpdate(raw); err != nil {
		t.Fatalf("ApplyUpdate(%s): %v", name, err)
	}
}

// applyAllStages replays every manifest stage onto a fresh doc and returns it.
func applyAllStages(t *testing.T, manifest fixtureManifest) *SessionDoc {
	t.Helper()
	doc := newSessionDocWithClientID(7)
	for _, stage := range manifest.Stages {
		for _, name := range stage.Updates {
			applyFixtureFile(t, doc, name)
		}
	}
	return doc
}

func TestJSFixturesInterop(t *testing.T) {
	manifest := loadManifest(t)
	if manifest.YjsVersion != "13.6.32" {
		t.Fatalf("manifest yjsVersion = %q, want %q", manifest.YjsVersion, "13.6.32")
	}

	doc := newSessionDocWithClientID(7)
	applyFixtureFile(t, doc, "js_full.bin")
	for _, stage := range manifest.Stages {
		for _, name := range stage.Updates {
			applyFixtureFile(t, doc, name)
		}

		gotIDs := noteIDs(t, doc)
		wantIDs := append([]string(nil), stage.IDs...)
		sort.Strings(wantIDs)
		if !reflect.DeepEqual(gotIDs, wantIDs) {
			t.Fatalf("stage %q: live ids = %v, want %v", stage.Name, gotIDs, wantIDs)
		}
		for id, want := range stage.Notes {
			text := doc.Notes().GetText(id)
			if text == nil {
				t.Fatalf("stage %q: GetText(%q) = nil", stage.Name, id)
			}
			if got := text.String(); got != want.Text {
				t.Fatalf("stage %q: note %q text = %q, want %q", stage.Name, id, got, want.Text)
			}
			if got := text.Length(); got != want.UTF16Length {
				t.Fatalf("stage %q: note %q length = %d, want %d", stage.Name, id, got, want.UTF16Length)
			}
		}
	}
}

func TestJSStateVectorMatches(t *testing.T) {
	doc := newSessionDocWithClientID(7)
	applyFixtureFile(t, doc, "js_full.bin")

	want, err := os.ReadFile(filepath.Join("testdata", "js_sv.bin"))
	if err != nil {
		t.Fatalf("read testdata/js_sv.bin: %v (run node fixtures/generate.mjs)", err)
	}
	if got := doc.EncodeStateVector(); !bytes.Equal(got, want) {
		t.Fatalf("EncodeStateVector() = %x, want byte-identical to testdata/js_sv.bin (%x)", got, want)
	}
}

func TestJSMapDeleteAndUnicode(t *testing.T) {
	manifest := loadManifest(t)
	doc := applyAllStages(t, manifest)

	if doc.Notes().Has(fixtureNoteD) {
		t.Fatalf("note D still present after the JS stages")
	}
	if doc.Notes().GetText(fixtureNoteD) != nil {
		t.Fatalf("GetText(note D) != nil after the JS stages")
	}

	last := manifest.Stages[len(manifest.Stages)-1]
	want, ok := last.Notes[fixtureNoteB]
	if !ok {
		t.Fatalf("manifest last stage %q has no note B", last.Name)
	}
	text := doc.Notes().GetText(fixtureNoteB)
	if text == nil {
		t.Fatalf("GetText(note B) = nil")
	}
	if got := text.String(); got != want.Text {
		t.Fatalf("note B text = %q, want %q", got, want.Text)
	}
	if got := text.Length(); got != want.UTF16Length {
		t.Fatalf("note B length = %d, want %d", got, want.UTF16Length)
	}
}
