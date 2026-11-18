# Build flow

All tasks run from the repository root through `just`; `scripts/plugins.mjs`
does the work and accepts optional plugin ids (default: every plugin under
`plugins/` that has a `manifest.json` and `package.json`).

| Recipe                       | What it does                                                               |
| ---------------------------- | -------------------------------------------------------------------------- |
| `just sync [plugin...]`      | Build, then copy `build/` to `%APPDATA%\app.map-making.local\plugins\<id>` |
| `just dev [plugin...]`       | Run `npm run dev` for each plugin in parallel until Ctrl+C                 |
| `just test [plugin...]`      | Run each plugin's `npm test` (plugins without tests are skipped)           |
| `just release [plugin...]`   | Build, then assemble `<plugin>/release/`; does not install into MMA        |
| `just package [plugin...]`   | `release`, then zip into `dist/`; also the all-plugins bundle when no names are given |
| `just publish [--dry-run]`   | Create GitHub releases for plugin versions that have no tag yet            |
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
- for a plugin declaring a sidecar, `sidecar/<name>.exe` and `version.txt`
  from the compiled crate (a warning if it is not built yet).

`build/` is the complete runtime payload and is what `just sync` installs.
`just dev` (each plugin's `npm run dev`, the shared watcher in
`scaffold/dev.mjs`) rebuilds on change and syncs the output to MMA, prefixing
every output line with the plugin name.

## Release

`scaffold/release-plugin.mjs` (run by `just release` or `npm run release`)
recreates `<plugin>/release/` as `build/` plus `README.md`, `CHANGES.md` and
`LICENSE` (the plugin's own, else `sidecar/LICENSE`). It fails if `build/` lacks something the
manifest promises, such as an unbuilt sidecar exe. Generated payloads are never
edited by hand.

## Packaging and GitHub releases

`just package` runs `release`, then `scripts/package.mjs` zips each
`release/` into `dist/<id>-<version>.zip`. Each zip has a top-level `<id>/`
folder so it unzips straight into MMA's plugins folder. With no plugin names it
also writes `dist/mma-plugins-all.zip` containing every plugin. `dist/` is
ignored by git.

Releases are published from this machine with `just publish`
(`scripts/publish.mjs`); there is no CI. It needs the
[GitHub CLI](https://cli.github.com) installed and logged in (`gh auth login`).

To release a plugin:

1. Raise `version` in `plugins/<id>/manifest.json` (and the sidecar version in
   the manifest and `Cargo.toml` if the helper changed).
2. Add a `## <version>` entry to `plugins/<id>/CHANGES.md`, newest first. Its
   text becomes the release notes.
3. Build the sidecar if the plugin has one (`cargo build --release`).
4. Commit, push to `main`, then run `just publish`.

`just publish` treats a plugin as new when no git tag `<id>-v<version>` exists.
It first checks that you are on `main` with a clean, fully pushed tree, that `gh`
is logged in, that every new version has a `CHANGES.md` entry, and that each
sidecar exe is built and not older than its sources; any failure stops it before
anything is built. After a confirmation prompt it runs `just package`, then:

- creates one release per new version: tag `<id>-v<version>`, asset
  `<id>-<version>.zip`, notes from the `CHANGES.md` entry (plus a source link for
  GPL sidecars);
- recreates the rolling `bundle` release holding `mma-plugins-all.zip` with
  every plugin at its current version, marked as the repository's latest release.

`just publish --dry-run` runs only the checks and shows what would be released;
`--yes` skips the prompt. If a run stops part-way, fix the cause and run it
again: plugins that already have their tag are skipped. The first run on a
repository with no tags releases every plugin.

The README's Download links open each plugin's releases filtered by its tag
prefix (`releases?q=<id>-v`), newest first, so they never need updating.

## Sidecars

Build the helper with `cargo build --release` in the plugin's `sidecar/`
before building the plugin; the shared build then picks up the exe from
`sidecar/target/x86_64-pc-windows-gnu/release/` or `sidecar/target/release/`.
Any extra toolchain setup a plugin needs is documented in its own README.
Close MMA before syncing: Windows cannot overwrite a running sidecar exe.
