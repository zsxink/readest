# Fork self-hosted release artifacts

## Scope

Fork `zsxink/readest` publishes self-hosted desktop/mobile clients through
`.github/workflows/build-selfhosted.yml`. It is deliberately separate from the
upstream-style `.github/workflows/release.yml`.

## Trigger and downloads

- Push an annotated tag matching `xv*` (for example `xv0.0.11`).
- `Build Self-Hosted Clients` starts directly from that tag; do **not** create a
  GitHub Release as part of this workflow.
- Download outputs from the Actions run's **Artifacts** section, not a Release
  page. Artifact names are `readest-android-<tag>`, `readest-macos-<tag>`, and
  `readest-windows-<tag>`.

## Targets

- Android: ARM64 only (`aarch64-linux-android`), with
  `tauri android build --target aarch64 --split-per-abi`.
  The generated APK is
  `apps/readest-app/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk`.
  Do not use `arm64-v8a` or `universal` output paths: Tauri's split build calls
  the ABI `arm64` in its output directory.
- macOS: ARM64 only (`aarch64-apple-darwin`), uploaded as a DMG.
- Windows: x64 only (`x86_64-pc-windows-msvc`), uploaded as an NSIS EXE.

## Android signing

Before the Android build, CI creates
`src-tauri/gen/android/keystore.properties` and decodes the release keystore.
The required GitHub repository secrets are:

- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_BASE64`

This signs the Gradle release APK and prevents the unsigned/invalid-package
installation issue previously surfaced as `packageinfo is null`.

## Self-hosted endpoint configuration

All three build jobs receive:

- `NEXT_PUBLIC_API_BASE_URL` from `API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` from `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `ANON_KEY`

`API_BASE_URL` must be the site origin (for example
`https://readest.example.com`), without `/api`, because the client appends it.
Updater artifacts and updater UI are disabled for these builds, so Tauri
updater signing secrets are not needed by this workflow.
