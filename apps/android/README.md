# MyNotes Android

Native Kotlin + Jetpack Compose client. Session links only (`/s/{roomId}#key`); the relay stays
zero-knowledge. The CRDT engine is the committed gomobile AAR in `engine/` — see
[`engine/README.md`](engine/README.md) for the binding, fixtures, and AAR regeneration.

## Layout

```text
apps/android/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml, gradle/wrapper/
  app/                  Kotlin app (Compose, Room, OkHttp)
  engine/               Go engine module, fixtures, and the committed engine.aar
scripts/android/
  rebuild-engine.sh     rebuild engine/libs/engine.aar
  verify-engine.sh      normalized comparison of a fresh AAR against the committed one
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

## Release previews

`.github/workflows/_release-android.yml` builds a signed release APK and publishes it as a GitHub
prerelease with install instructions. It is called from `cicd.yml` on main pushes and can be
dispatched manually.

Signing uses a **dedicated preview key** (`ANDROID_PREVIEW_KEYSTORE_BASE64`,
`ANDROID_PREVIEW_KEYSTORE_PASSWORD`, `ANDROID_PREVIEW_KEY_ALIAS`, `ANDROID_PREVIEW_KEY_PASSWORD`
repository secrets). It is preview-only: losing it only breaks preview updates, and the final
release key from the plan's section 13 runbook stays entirely separate. Preview APKs are release
builds but unminified while the app is in preview.
