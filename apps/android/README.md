# MyNotes Android

Native Kotlin + Jetpack Compose client. Session links only (`/s/{roomId}#key`); the relay stays
zero-knowledge. The CRDT engine is the committed gomobile AAR in `engine/` — see
[`engine/README.md`](engine/README.md) for the binding, fixtures, and AAR regeneration.

## Features (through M8)

- **Sessions** — create, rename, reorder and delete sessions; a title cache derives each
  session's display title without keeping its engine open; status is shown per session
  (local / connecting / live / offline / expired / key missing / sync blocked / creation
  uncertain / deleting).
- **Notes** — multiple notes per session (`Y.Map<Y.Text>`), created, deleted and switched from
  the editor; undo/redo per note.
- **Editor** — markdown editing with a formatting toolbar and Typora-style concealment.
- **Sync** — encrypted Yjs over the relay: catch-up through `GET /rooms/{id}/updates`, then a
  WebSocket; every local change is appended to the outbox and only removed when its ciphertext
  echoes back; the log is compacted with an encrypted snapshot; reconnect backoff and the
  server's room caps surface as `sync blocked`.
- **Export** — a note is written to the app cache as `.md` (unique filename, stale copies pruned
  after 24h) and shared through the `FileProvider`.
- **Share / create** — a local session is posted to the relay as a room and turned into a view
  link and an owner link (when an edit token exists); share links are imported by paste or
  `ACTION_SEND`, a viewer can be upgraded to owner, and an expired owner session can be re-seeded
  into a fresh room.
- **App Links** — `https://notes.mdelacour.com/s/` is declared `autoVerify` so verified links
  open the app; unverified/raw links are also handled via `ACTION_VIEW`.

## Layout

```text
apps/android/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml, gradle/wrapper/
  app/                  Kotlin app (Compose, Room, OkHttp)
  engine/               Go engine module, fixtures, and the committed engine.aar
scripts/android/
  rebuild-engine.sh     rebuild engine/libs/engine.aar
  verify-engine.sh      normalized comparison of a fresh AAR against the committed one
  privacy-audit.sh      fail if source logging references secrets or note content
  gradle.sh             Gradle wrapper with the NixOS AAPT2 workaround
  gen-fixtures.sh       regenerate the JS/Go interop fixtures
```

## Build and test

Everything runs in the Android dev shell, which provides Go 1.26, JDK 17, Kotlin, and the Android
SDK 36 / build-tools 37.0.0 / NDK 29:

```sh
nix develop .#android -c ./scripts/android/gradle.sh :app:assembleDebug
nix develop .#android -c ./scripts/android/gradle.sh lintDebug testDebugUnitTest
```

`scripts/android/gradle.sh` passes `-Pandroid.aapt2FromMavenOverride=<sdk aapt2>` when the SDK's
AAPT2 exists, because AGP's downloaded AAPT2 cannot run on NixOS without nix-ld. On CI the override
is skipped and the downloaded AAPT2 is used.

`scripts/android/privacy-audit.sh` runs from the repo root with no Nix shell and fails if a source
line logs a secret-bearing identifier or note content. CI runs it before Gradle; run it locally
after touching logging in `app/src/main`.

## Version matrix

| Component | Pin |
| --- | --- |
| Kotlin + Compose compiler plugin | 2.3.20 |
| Android Gradle Plugin | 8.13.2 |
| Gradle wrapper | 8.14.3 |
| JDK | 17 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 26 |
| Compose BOM | 2026.06.01 (Compose 1.11.4, Material3 1.4.0) |
| Room | 2.8.5 |
| OkHttp | 5.4.0 |
| `sh.calvin.reorderable` | 3.1.0 |
| KSP | 2.3.12 |

Two pins differ from the original plan because the Sept 2026 ecosystem moved past AGP 8.13.2:
OkHttp 5.5.0 requires `compileSdk 37`, and Compose BOM 2026.09.00 / AndroidX 1.19 require AGP 9.1.
The plan's toolchain pins (AGP 8.13.2, Gradle 8.14.3, compileSdk 36) were kept and the libraries
were pinned to the newest AGP-8-compatible releases.

## Hardening (M9)

- **One decrypted session at a time.** Only the editor holds an `OpenSession`, and it closes it
  (engine, executor and note handles) when the editor is cleared. The session list never keeps a
  live engine: `SessionTitleCache` opens a short-lived engine per uncached title on a dedicated
  executor and closes both in `finally`.
- **Backup is off.** `android:allowBackup="false"` plus `backup_rules.xml` and
  `data_extraction_rules.xml` exclude databases, shared prefs, files and external storage. Room
  (`mynotes.db`) and DataStore (`mynotes-settings`) use the defaults, i.e. app-private storage.
- **Key loss keeps the data.** Losing the Android Keystore wrapping key never deletes notes.
  `SessionRepository.startupCleanup()` tries to unwrap every session's room key and, on failure,
  marks the session `KEY_MISSING`; the wrapped key and ciphertext are left untouched, so a
  restored/regenerated key can still recover the session.

## App icon

The launcher icon is the Foldmark mark (concept 1 of the approved logo set): one vector path on a
pure white adaptive background, with the same geometry reused as the Android 13+ monochrome layer.
No rounded-square container is baked in; Android's mask applies. The geometry lives in exactly one
file, `app/src/main/res/drawable/ic_launcher_mark.xml`, which is referenced by both
`mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` as `foreground` and `monochrome`, so
swapping to concept 2 (Cipherlink) or concept 3 (Quiet Page) means replacing that one file with the
concept's 108x108 path. Keep the 108x108 viewport and the 21..87 safe zone.

## Release previews

`.github/workflows/_release-android.yml` builds a signed release APK and publishes it as a GitHub
prerelease with install instructions. It is called from `cicd.yml` on main pushes, can be dispatched
manually, and also runs for `android-preview-*` tags.

Signing uses a **dedicated preview key** that exists only in the `ANDROID_PREVIEW_*` Actions
secrets (`ANDROID_PREVIEW_KEYSTORE_BASE64`, `ANDROID_PREVIEW_KEYSTORE_PASSWORD`,
`ANDROID_PREVIEW_KEY_ALIAS`, `ANDROID_PREVIEW_KEY_PASSWORD`); it is never stored in the repo or a
local file. It is preview-only: losing it only breaks preview updates, and the final release key
from the plan's section 13 runbook stays entirely separate. Preview APKs are release builds but
unminified while the app is in preview.

Verified App Links need more than the manifest's `autoVerify`: the preview certificate's SHA-256
(printed by the release workflow) must be published in `/.well-known/assetlinks.json` for
`notes.mdelacour.com`. That publication is captain-owned (plan section 13); until it lands, links
still open the app but are not OS-verified.
