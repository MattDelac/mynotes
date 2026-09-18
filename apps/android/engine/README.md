# Android engine binding

`apps/android/engine` is a small Go module that exposes the [ygo](https://github.com/Deln0r/ygo)
CRDT document model through a gomobile-bindable facade. It is the engine under the MyNotes Android
app: one `SessionDoc` owns a single Yjs document whose root `Y.Map` named `notes` holds every note
as a `Y.Text`, exactly like the web client's session model. Everything mutating goes through the
facade's local-origin transactions, so undo captures only local edits and never remote updates
applied through `ApplyUpdate`. The exported surface (`SessionDoc`, `Notes`, `Text`, `Undo`) is the
M0 gate; the Java/Kotlin bindings are generated from it, not hand-written.

## Pinned dependencies

- `github.com/Deln0r/ygo v1.19.0` (MIT) — the CRDT engine.
- `golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e` — gomobile/gobind, pinned in `go.mod`.
- Go 1.26 (the `go.mod` tool directives install the two gomobile commands at that exact revision).

## Tests

```sh
cd apps/android/engine
go test ./...
```

This covers the JS↔Go interop fixtures, golden bytes, undo semantics, and the outbox helper. The
golden tests read `testdata/`, so they fail with a pointer to `scripts/android/gen-fixtures.sh` if
the fixtures are stale.

## Fixtures

`scripts/android/gen-fixtures.sh` regenerates the committed fixtures in dependency order:

1. `pnpm install --frozen-lockfile`
2. `node apps/android/engine/fixtures/generate.mjs` — writes the JS-authored updates and manifest
3. `go test ./... -run TestGenerateGolden -update -count=1` — writes the Go-authored goldens
4. `node apps/android/engine/fixtures/verify.mjs` — applies the Go goldens back into a real Y.Doc
5. `go test ./... -count=1` — the full suite against the regenerated set

Step 4 is the interop guarantee, not a formality: the fixtures are produced by the web client's
exact `yjs@13.6.32`, and `verify.mjs` replays the Go engine's byte output into that same
implementation and checks note ids, text, and UTF-16 lengths. Without it, the Go tests would only
prove ygo is self-consistent; with it, they prove the bytes are compatible with the actual web
client. The script fails loudly on any step and is deterministic (fixed client IDs), so re-running
it produces byte-identical fixtures.

## Rebuilding the AAR

```sh
nix develop --extra-experimental-features 'nix-command flakes' .#android -c ./scripts/android/rebuild-engine.sh
```

The script installs the `gobind`/`gomobile` revisions pinned by the module, runs `gomobile init`,
and binds `com.mdelacour.mynotes` for `ANDROID_ABIS` (default `arm64-v8a,x86_64`) at
`ANDROID_API=26`. Override without editing the script:

```sh
ANDROID_ABIS=arm64-v8a,x86_64,armeabi-v7a ANDROID_API=30 \
  OUT=/tmp/engine.aar ./scripts/android/rebuild-engine.sh
```

Supported ABIs and their gomobile targets: `arm64-v8a` → `android/arm64`, `x86_64` →
`android/amd64`, `armeabi-v7a` → `android/arm`, `x86` → `android/386`. Any other ABI is an error.
All of this must run inside `nix develop .#android`, which provides `ANDROID_HOME`,
`ANDROID_NDK_HOME`, and `JAVA_HOME`; the script fails with that instruction when they are unset.

`scripts/android/inspect-engine.sh` prints the same artifact evidence on demand (entries, sizes,
hashes, class list, native libraries, and a forbidden-dependency check).

## Kotlin smoke

`apps/android/engine/smoke/Smoke.kt` round-trips text through the generated binding: create a note,
insert UTF-16 text (`"héllo 🎉"` is 8 UTF-16 code units), sync full state to a second `SessionDoc`,
sync a diff, exercise undo, and check the local/remote origin flags. It compiles against the AAR's
`classes.jar`:

```sh
tmp="$(mktemp -d)"
nix develop --extra-experimental-features 'nix-command flakes' .#android -c bash -c "
  unzip -o -q apps/android/engine/libs/engine.aar classes.jar -d '$tmp' &&
  kotlinc -classpath '$tmp/classes.jar' \
    apps/android/engine/smoke/Smoke.kt -jvm-target 17 -d '$tmp/smoke.jar'
"
```

Compiling is the M0 check. *Running* the smoke requires an Android device or emulator (and thus the
M1/M2 milestones) — gomobile's `libgojni.so` is Android-only, so the JVM `main()` cannot be
executed on the host.

## Measured numbers

Built with `nix develop .#android` (Go 1.26.7, NDK 29.0.14206865) and the default ABIs:

| Item | Value |
| --- | --- |
| `libs/engine.aar` | 4,425,874 bytes |
| AAR sha256 | `2fdaf60af5a331769f07b126876e0da4a328d3375bf0fbdb8e7461e2669ab8ee` |
| Total uncompressed | 11,279,119 bytes |
| `classes.jar` | 13,889 bytes |
| `jni/arm64-v8a/libgojni.so` | 5,534,952 bytes (compressed 2,121,676) |
| `jni/x86_64/libgojni.so` | 5,730,064 bytes (compressed 2,291,071) |
| `libs/engine-sources.jar` | 10,130 bytes (generated Java sources for IDE navigation) |
| Other entries | `AndroidManifest.xml` 145, `proguard.txt` 69, `R.txt` 0, `res/` 0 |

The AAR is committed as the Android build input, together with the `-sources.jar` that
`gomobile bind` emits next to it (so a rebuild leaves the worktree clean). Rebuilds are *not*
byte-reproducible — the native link and zip step embed build ids and timestamps — so the table
above describes the committed M0 artifact only; `scripts/android/inspect-engine.sh` prints the
current numbers. CI must compare normalized contents or per-entry hashes rather than raw zip
bytes, and `AndroidManifest.xml` must keep `minSdkVersion=26`.

## Why a dedicated dev shell

The `nix develop .#android` shell (and its `nodejs_22` addition) exists because the M0 gate cannot
build without an Android SDK/NDK, `gomobile`, a JDK, and Kotlin — none of which the repository's
default dev shell provides. Keeping this in a separate shell means the normal frontend/backend
workflow does not pay for the multi-gigabyte Android toolchain.
