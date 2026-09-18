package engine

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// update regenerates the committed Go-side golden fixtures. Run with
// `go test ./... -run TestGenerateGolden -update -count=1`, then
// `node fixtures/verify.mjs` to refresh testdata/verdict.json.
var update = flag.Bool("update", false, "rewrite the committed golden fixtures in testdata/")

const goldenNewID = "66666666-6666-4666-8666-666666666666"

type goldenNote struct {
	Text        string `json:"text"`
	UTF16Length int    `json:"utf16Length"`
}

type goldenExpect struct {
	IDs   []string              `json:"ids"`
	Notes map[string]goldenNote `json:"notes"`
}

type verdictCheck struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
}

type fixtureVerdict struct {
	OK         bool              `json:"ok"`
	YjsVersion string            `json:"yjsVersion"`
	Checks     []verdictCheck    `json:"checks"`
	SHA256     map[string]string `json:"sha256"`
}

// goldenSession builds the deterministic Go-authored scenario on top of every
// JS stage and returns the doc, the pre-op state vector, and the expected
// post-op state.
func goldenSession(t *testing.T) (*SessionDoc, []byte, goldenExpect) {
	t.Helper()
	manifest := loadManifest(t)
	doc := applyAllStages(t, manifest)
	baseSV := doc.EncodeStateVector()

	if err := doc.Notes().Create(goldenNewID); err != nil {
		t.Fatalf("Create(%s): %v", goldenNewID, err)
	}
	mustInsert(t, doc.Notes().GetText(goldenNewID), 0, "Go-created note")
	mustInsert(t, doc.Notes().GetText(fixtureNoteA), 0, "Go says: ")
	mustDelete(t, doc.Notes().GetText(fixtureNoteB), 15, 1)
	mustInsert(t, doc.Notes().GetText(fixtureNoteB), 15, "🌍")
	if err := doc.Notes().Delete(fixtureNoteC); err != nil {
		t.Fatalf("Delete(%s): %v", fixtureNoteC, err)
	}

	return doc, baseSV, buildGoldenExpect(t, doc)
}

func buildGoldenExpect(t *testing.T, doc *SessionDoc) goldenExpect {
	t.Helper()
	ids := noteIDs(t, doc)
	expect := goldenExpect{IDs: ids, Notes: make(map[string]goldenNote, len(ids))}
	for _, id := range ids {
		text := doc.Notes().GetText(id)
		if text == nil {
			t.Fatalf("GetText(%q) = nil while building golden expectation", id)
		}
		expect.Notes[id] = goldenNote{Text: text.String(), UTF16Length: text.Length()}
	}
	return expect
}

func TestGenerateGolden(t *testing.T) {
	if !*update {
		t.Skip("set -update to regenerate the committed golden fixtures")
	}
	doc, baseSV, expect := goldenSession(t)
	diff, err := doc.EncodeDiff(baseSV)
	if err != nil {
		t.Fatalf("EncodeDiff(baseSV): %v", err)
	}
	expectJSON, err := json.MarshalIndent(expect, "", "  ")
	if err != nil {
		t.Fatalf("marshal golden expectation: %v", err)
	}
	expectJSON = append(expectJSON, '\n')

	writeFixture := func(name string, data []byte) {
		t.Helper()
		path := filepath.Join("testdata", name)
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		t.Logf("wrote %s (%d bytes)", path, len(data))
	}
	writeFixture("go_ops_full.bin", doc.EncodeStateAsUpdate())
	writeFixture("go_ops_sv.bin", doc.EncodeStateVector())
	writeFixture("go_ops_diff.bin", diff)
	writeFixture("expect.json", expectJSON)
}

func TestGoldenGoToJS(t *testing.T) {
	doc, baseSV, expect := goldenSession(t)
	diff, err := doc.EncodeDiff(baseSV)
	if err != nil {
		t.Fatalf("EncodeDiff(baseSV): %v", err)
	}

	compareGoldenBytes(t, "go_ops_full.bin", doc.EncodeStateAsUpdate())
	compareGoldenBytes(t, "go_ops_sv.bin", doc.EncodeStateVector())
	compareGoldenBytes(t, "go_ops_diff.bin", diff)

	raw, err := os.ReadFile(filepath.Join("testdata", "expect.json"))
	if err != nil {
		t.Fatalf("read testdata/expect.json: %v (run scripts/android/gen-fixtures.sh)", err)
	}
	var committed goldenExpect
	if err := json.Unmarshal(raw, &committed); err != nil {
		t.Fatalf("parse testdata/expect.json: %v", err)
	}
	if !reflect.DeepEqual(committed, expect) {
		t.Fatalf("recomputed expectation differs from testdata/expect.json (run scripts/android/gen-fixtures.sh)")
	}

	verdictRaw, err := os.ReadFile(filepath.Join("testdata", "verdict.json"))
	if err != nil {
		t.Fatalf("read testdata/verdict.json: %v (run node fixtures/verify.mjs)", err)
	}
	var verdict fixtureVerdict
	if err := json.Unmarshal(verdictRaw, &verdict); err != nil {
		t.Fatalf("parse testdata/verdict.json: %v", err)
	}
	if !verdict.OK {
		t.Fatalf("testdata/verdict.json reports ok=false (run node fixtures/verify.mjs)")
	}
	for _, check := range verdict.Checks {
		if !check.OK {
			t.Fatalf("testdata/verdict.json check %q reports ok=false (run node fixtures/verify.mjs)", check.Name)
		}
	}
	for name, want := range verdict.SHA256 {
		raw, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatalf("read testdata/%s: %v (run scripts/android/gen-fixtures.sh)", name, err)
		}
		sum := sha256.Sum256(raw)
		if got := hex.EncodeToString(sum[:]); got != want {
			t.Fatalf("stale hash for testdata/%s: verdict expects %s, file is %s (run scripts/android/gen-fixtures.sh)",
				name, want, got)
		}
	}
}

func compareGoldenBytes(t *testing.T, name string, got []byte) {
	t.Helper()
	want, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read testdata/%s: %v (run scripts/android/gen-fixtures.sh)", name, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("testdata/%s is stale: encoded %d bytes, committed %d bytes (run scripts/android/gen-fixtures.sh)",
			name, len(got), len(want))
	}
}
