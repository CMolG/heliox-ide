# Release Checklist

Audit action 1.10 / the release→web workstream (`docs/auditoria-integral-2026-07.md`,
§9). The pipeline's one acceptance test: publishing a release requires only

```
git tag vX.Y.Z
git push --tags
```

Everything below either makes that true (CI) or is the small amount of human
judgment (QA, clicking "Publish") that stays a checklist on purpose — a
release nobody looked at is exactly how a broken installer reaches users.

## Ordered steps

1. **Bump the version** in `package.json` (`"version"`). No `v` prefix here —
   Electron Forge's `PublisherGithub` derives the release tag from this field
   (`v${version}`), so it must match the tag you're about to push.
2. **Update `CHANGELOG.md`**: move the `[Unreleased]` section's contents under
   a new `## [X.Y.Z] - YYYY-MM-DD` heading, leaving `[Unreleased]` empty for
   the next round.
3. **Tag and push**:
   ```
   git tag vX.Y.Z
   git push --tags
   ```
   This is the only step a human must run manually from here on.
4. **CI builds a draft release** (`.github/workflows/release.yml`, triggered
   by the `v*` tag push):
   - Matrix job `publish` (ubuntu/macos/windows): `npm ci` → `npm run publish`
     (Electron Forge → `PublisherGithub`). Each OS leg uploads its installers
     to the same draft release (created on first upload, reused after).
   - Job `checksums` (needs: `publish`, so it waits for all three legs):
     downloads every asset for the tag via `gh release download`, hashes them
     with `shasum -a 256`, and uploads `SHA256SUMS` to the same draft.
   - The release is **always a draft** (`draft: true` in `forge.config.ts`) —
     nothing reaches users until step 7.
5. **Manual QA matrix** — install the *draft's* artifacts on a clean machine
   per platform before publishing:
   - macOS: download the `.dmg` (arm64 and x64), mount, drag to Applications,
     launch. Until code signing is configured (§ Signing below), expect
     Gatekeeper's "can't be opened" warning — right-click → Open bypasses it;
     this is expected today, not a bug.
   - Windows: download and run the Squirrel `Setup.exe`. Until signing is
     configured, expect a SmartScreen warning ("More info" → "Run anyway").
   - Linux: install the `.deb` (`dpkg -i` / a GUI installer) and the `.rpm`
     (`rpm -i` / a GUI installer) on their respective distro families.
   - On each platform: the app launches, opens a project, and the console
     shows the crash-reporter dump path (audit 1.8a) with no startup errors.
6. **Verify checksums** — on any machine with the installers downloaded:
   ```
   shasum -a 256 -c SHA256SUMS
   ```
   All entries should print `OK`.
7. **Publish the draft** from the GitHub Releases UI (or `gh release edit
   vX.Y.Z --draft=false`). This is the moment the release becomes visible to
   users and to update.electronjs.org.
8. **Verify helioxide.com** shows the new version under `/download` after ISR
   revalidation (≤ 1 hour) — that page resolves the latest release from the
   GitHub Releases API; nothing to redeploy on the web side.
9. **Verify auto-update**: install the *previous* published version, wait for
   `update-electron-app`'s hourly check (or relaunch, which also checks), and
   confirm it offers/applies the new version. Only meaningful once the repo is
   public with at least one prior published release (see below).
10. **Announce** — release notes link, changelog highlight, whatever channels
    apply (see `docs/auditoria-integral-2026-07.md` §7/Fase 2 for the
    marketing cadence this feeds into).

## Signing — env vars reference

Mirrors the comment block in `forge.config.ts`. All of these are GitHub
Actions secrets consumed by `release.yml`; **none exist yet**, so every
release today is unsigned. Configure them in the repo's Settings → Secrets
and future runs pick them up automatically — no workflow change needed.

| Var | Effect when set |
|---|---|
| `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID` | All three together enable `osxNotarize` (notarytool, app-specific-password strategy). Their presence also turns on `osxSign` (notarization requires a signed app). |
| `OSX_SIGN_IDENTITY` | Explicit codesign identity string. Optional even while notarizing — omitted, `@electron/osx-sign` auto-discovers a "Developer ID Application" certificate from the default keychain. |
| `WINDOWS_SIGN_PARAMS` | Raw `signtool.exe` params string, passed through as-is (covers cloud/EV-cert signing setups). Takes priority over the two vars below. |
| `WINDOWS_CERTIFICATE_FILE`, `WINDOWS_CERTIFICATE_PASSWORD` | Simple file-based Authenticode signing. |

Unsigned degrade path (today's default): no throw, no warning spam — one
summary line logged when `forge.config.ts` is evaluated (`npm start`,
`package`, `make`, `publish` all trigger it).

## update.electronjs.org — the public-repo requirement

`update-electron-app` (audit 1.2) talks to `update.electronjs.org`, which
**requires the target repository to be public and to have at least one
published (non-draft) release**. This is a documented fact about that
service, not a blocker introduced by this checklist — auto-update is wired
and inert until both are true, and step 9 above is the first point where it
can be meaningfully tested.

## Artifact naming

Electron Forge's maker defaults already produce stable, versioned, per-arch
filenames — nothing was changed here to avoid destabilizing a working
default:

| Platform | Maker | Example filename |
|---|---|---|
| macOS | `MakerDMG` | `Fluxor IDE-0.3.0-arm64.dmg`, `Fluxor IDE-0.3.0-x64.dmg` |
| Windows | `MakerSquirrel` | `Fluxor IDE-0.3.0 Setup.exe` (+ `RELEASES`, `.nupkg`) — x64 only |
| Linux (Debian) | `MakerDeb` | `fluxor-ide_0.3.0_amd64.deb` |
| Linux (RPM) | `MakerRpm` | `fluxor-ide-0.3.0-1.x86_64.rpm` |

helioxide.com's download page matches releases by **file extension and an
arch substring** (`.dmg`/`.exe`/`.deb`/`.rpm` + `arm64`/`x64`/`amd64`/etc.),
not exact filenames — small naming differences across Electron Forge/maker
versions don't need to be tracked here or coordinated with the web repo.

## Rollback

If a published release turns out to be broken:
1. Do **not** delete the GitHub release or tag if `update-electron-app`
   clients may have already picked it up — that can leave installed apps in
   an inconsistent state. Prefer shipping a fixed `vX.Y.Z+1` promptly.
2. If the release was caught before wide pickup (e.g., within the hourly
   auto-update window), mark it as a pre-release or delete it, then delete
   the tag (`git push --delete origin vX.Y.Z`) and re-tag once fixed.
3. Note the incident in `CHANGELOG.md` under the next release's `### Fixed`.
