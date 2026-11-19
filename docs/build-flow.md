# Build flow

All tasks run from the repository root through `just`; `scripts/plugins.mjs`
does the work and accepts optional plugin ids (default: every plugin under
`plugins/` that has a `manifest.json` and `package.json`).

| Recipe                       | What it does                                                               |
| ---------------------------- | -------------------------------------------------------------------------- |
| `just sync [plugin...]`      | Build (a Rust sidecar too), then copy `build/` to `%APPDATA%\app.map-making.local\plugins\<id>` |
| `just dev [plugin...]`       | Run `npm run dev` for each plugin in parallel until Ctrl+C                 |
| `just test [plugin...]`      | Run each plugin's `npm test`, then its sidecar's Rust tests (`--no-sidecar` skips them) |
| `just package [plugin...]`   | Build (a Rust sidecar too), assemble `<plugin>/release/`, then zip into `dist/`; also the all-plugins bundle when no names are given. Does not install into MMA |
| `just release [--dry-run]`   | Check, then start the Release workflow on GitHub, which publishes          |
| `just new <name> [template]` | Create `plugins/<name>` from a template; asks for one when omitted         |

A plugin's dependencies are installed with `npm install` the first time a
recipe finds no `node_modules`.

## Build

`scaffold/build-plugin.mjs` (run by `npm run build`) clears `<plugin>/build/`
and writes:

- `index.js`: the UI bundle, targeting MMA's browser runtime;
- the procedure bundle, when the manifest names one, from `src/procedure.ts`
  as neutral ES2022 because it runs in QuickJS;
- `manifest.json`, and `NOTICE.md` when present;
- for a plugin declaring a sidecar, `sidecar/<name>.exe` (Windows) or `sidecar/<name>`
  (Linux, macOS) and `version.txt` from the compiled crate, for the platform being built
  (this machine's, or `MMA_PLATFORM`); a warning if it is not built yet.

`build/` is the complete runtime payload and is what `just sync` installs.
`just dev` (each plugin's `npm run dev`, the shared watcher in
`scaffold/dev.mjs`) rebuilds on change and syncs the output to MMA, prefixing
every output line with the plugin name.

## Release

`scaffold/release-plugin.mjs` (run by `just package`, or `npm run release` in a plugin folder)
recreates `<plugin>/release/` as `build/` plus `README.md`, `CHANGES.md` and
`LICENSE` (the plugin's own, else `sidecar/LICENSE`). It fails if `build/` lacks something the
manifest promises, such as an unbuilt sidecar exe. Generated payloads are never
edited by hand.

## Packaging and GitHub releases

`just package` assembles each `release/` (`scripts/plugins.mjs release`), then `scripts/package.mjs` archives each
`release/` for the platform being built (this machine's, or `--platform`). Each archive has a
top-level `<id>/` folder so it extracts straight into MMA's plugins folder. Windows gets `.zip`,
Linux and macOS get `.tar.gz` (`archive` in `scaffold/platforms.mjs`):

- a plugin with a sidecar gets one archive per platform, `dist/<id>-<version>-<platform>.<zip|tar.gz>`;
- a plugin without one gets a single `dist/<id>-<version>.zip`;
- with no plugin names there is also `dist/mma-plugins-all-<platform>.<zip|tar.gz>` with every plugin.

The platforms are the ones MMA supports for sidecars and are named the way MMA names them:
`windows-x64`, `linux-x64` and `macos-arm64` (`scaffold/platforms.mjs`). The sidecar binary is
`<name>.exe` on Windows and `<name>` elsewhere. `dist/` is ignored by git.

### Releases (GitHub Actions)

Releases are built and published by the **Release** workflow
(`.github/workflows/release.yml`), not on this machine. It runs automatically when a push to
`main` changes a plugin's `plugins/<id>/manifest.json`, and can be started by hand (below).

To release a plugin:

1. Raise `version` in `plugins/<id>/manifest.json` (and the sidecar version in
   the manifest and `Cargo.toml` if the helper changed).
2. Add a `## <version>` entry to `plugins/<id>/CHANGES.md`, newest first. Its
   text becomes the release notes.
3. Commit and push to `main`. That is the whole release: the workflow does the rest.

A plugin is new when no git tag `<id>-v<version>` exists (`scripts/release-plan.mjs`). A push that
changes a manifest without bumping a version, or a bump without a `CHANGES.md` entry, releases
nothing (the latter fails the run's **plan** job, which shows in the Actions tab). The bundle is
recreated whenever at least one plugin is released.

To start it by hand, for a retry or to try the builds without releasing, run `just release`
(`scripts/release.mjs`; needs the [GitHub CLI](https://cli.github.com) logged in, `gh auth login`),
or "Run workflow" in the Actions tab. `just release` checks that you are on `main` with a clean,
fully pushed tree, that `gh` is logged in and that every new version has a `CHANGES.md` entry, shows
the plan, asks for confirmation and starts the workflow. `--dry-run` runs only the checks; `--yes`
skips the prompt; `--build-only` starts the workflow in its build-and-test mode, which publishes
nothing and is the way to try the Linux and macOS builds. If a release is already running, a second
run waits for it and then finds nothing new.

The workflow's jobs:

1. **plan**: the same check, on the pushed commit, deciding whether anything is new.
2. **sidecars** (one job per platform): runs the sidecar unit tests and builds the binary on
   the platform's own runner with `scripts/sidecar.mjs`, the same command as locally:
   `windows-x64` on `windows-latest` (MinGW gcc and the GNU target are installed first),
   `linux-x64` on `ubuntu-22.04` (a low glibc requirement) and `macos-arm64` on `macos-15`.
   Each uploads `dist/sidecars/<platform>/`.
3. **package**: runs the plugin tests (without the sidecar ones, already run above), then for each platform assembles every plugin's
   `release/` (`MMA_SIDECAR_DIR` points at the downloaded binaries) and zips it.
4. **publish** (skipped in build-only mode): `scripts/release-upload.mjs` creates one release
   per new version, tag `<id>-v<version>`, with the plugin's archives (one per system when it has a sidecar),
   notes from the `CHANGES.md` entry plus the install steps for each system (and a note on the
   per-system archives, and a source link, for GPL sidecars), and recreates the rolling `bundle` release with the per-platform
   all-plugins zips, marked as the repository's latest release. It refuses to run outside Actions.

If a run fails, fix the cause and start it again with `just release` (or push a fix that touches a
manifest): plugins that already have their tag are skipped. The first run on a repository with no
tags releases every plugin.

The README's Download links open each plugin's releases filtered by its tag
prefix (`releases?q=<id>-v`), newest first, so they never need updating.

## Sidecars

The sidecar is part of the plugin: `just sync` and `just package` compile it first (this machine's
platform only; the Release workflow supplies the other platforms' binaries), then the shared build
picks the binary up from `sidecar/target/<triple>/release/` or `sidecar/target/release/` (also staged
in `dist/sidecars/<platform>/<id>/`). `just dev` and a bare `npm run build` do not compile it; they
reuse the last one. `just test` runs the sidecar's unit tests after the plugin's own.

`scripts/sidecar.mjs` (`build` or `test`; called by those recipes and by the workflow) is plain `cargo` for this machine's platform with the settings each one
needs, and it checks the prerequisites before building. Besides Rust (https://rustup.rs) a sidecar
whose dependencies contain C code needs a C compiler:

| Platform | Needs besides Rust |
| --- | --- |
| Windows | MSYS2's MinGW gcc (https://www.msys2.org, then `pacman -S mingw-w64-x86_64-gcc` in it; `C:\msys64\mingw64\bin` is found even when it is not on PATH) and the GNU target: `rustup target add x86_64-pc-windows-gnu`. The GNU target is used because MSVC cannot compile C libraries such as om-file-format. |
| Linux | a C compiler, e.g. `apt install build-essential` |
| macOS | Xcode's command line tools: `xcode-select --install` |

Nothing else: no Docker, no libclang, no setup script. (`weatherPlus` vendors its one awkward
dependency, so it builds from a plain checkout; see `plugins/weatherPlus/sidecar/vendor/README.md`.)
On Windows the recipes build with `--target x86_64-pc-windows-gnu`, so a bare `cargo build` in a
sidecar folder produces a different (MSVC) build there; use the recipe.

Close MMA before syncing: Windows cannot overwrite a running sidecar exe.
