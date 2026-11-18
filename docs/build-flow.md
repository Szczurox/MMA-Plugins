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
recreates `<plugin>/release/` as `build/` plus `README.md` and `LICENSE` (the
plugin's own, else `sidecar/LICENSE`). It fails if `build/` lacks something the
manifest promises, such as an unbuilt sidecar exe. Generated payloads are never
edited by hand.

## Packaging and GitHub releases

`just package` runs `release`, then `scripts/package.mjs` zips each
`release/` into `dist/<id>-<version>.zip`. Each zip has a top-level `<id>/`
folder so it unzips straight into MMA's plugins folder. With no plugin names it
also writes `dist/mma-plugins-all.zip` containing every plugin. `dist/` is
ignored by git.

`.github/workflows/release.yml` publishes releases when `main` is pushed:

1. `scripts/ci-plan.mjs` marks a plugin as bumped when no git tag
   `<id>-v<version>` exists. So releasing is: raise `version` in
   `plugins/<id>/manifest.json`, push to `main`. Nothing happens when no
   version is new.
2. For plugins with a sidecar, `scripts/ci-sidecar.mjs` reuses the exe from the
   plugin's latest release if nothing under `sidecar/` changed since that
   release's tag; otherwise it compiles it (MSYS2 gcc, `setup.mjs`,
   `cargo build --release`, Rust build cached).
3. `just package` builds and zips every plugin.
4. `scripts/ci-publish.mjs` creates one release per bumped plugin (tag
   `<id>-v<version>`, asset `<id>-<version>.zip`, notes from the commits that
   touched that plugin) and recreates the rolling `latest` release holding
   `mma-plugins-all.zip` with every plugin at its current version.

The first run on a repository with no tags releases every plugin. Run
`node scripts/ci-plan.mjs` locally to see what a push would release. The
workflow can also be started by hand (`workflow_dispatch`).

## Sidecars

Build the helper with `cargo build --release` in the plugin's `sidecar/`
before building the plugin; the shared build then picks up the exe from
`sidecar/target/x86_64-pc-windows-gnu/release/` or `sidecar/target/release/`.
Any extra toolchain setup a plugin needs is documented in its own README.
Close MMA before syncing: Windows cannot overwrite a running sidecar exe.
