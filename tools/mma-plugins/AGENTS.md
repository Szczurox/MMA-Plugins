# MMA plugins: scaffold layout

Plugin sources and the shared build scaffold for Map Making App (MMA) 0.10.x. Read
`.claude/rules/architecture.md` for how a plugin is organised and the constraints that matter.

## Layout

```text
tools/
  dev/mma-plugins/            this folder: plugin sources, sync.mjs, docs
    <pluginId>/               one folder per plugin (moon, pointer, weatherPlus)
    sync.mjs                  build + install every plugin into MMA; --release also updates tools/mma-plugins
                              (`node sync.mjs [--release] [--test] [pluginId...]`)
    scaffold/                 the shared upstream build scaffold (plugins reach it as ../scaffold)
      build-plugin.mjs          esbuild: src/index.ts(x) -> index.js, src/procedure.ts -> the manifest's procedure
      package-plugin.mjs        copies manifest + built files into the release folder
      dev.mjs                   watch build + sync to %APPDATA%\app.map-making.local\plugins\<id>
      mma-externals.js          esbuild plugin: app-bundled libraries (react, ...) resolve at runtime
      types/                    MMA SDK typings (mma.d.ts) and tsconfig.base.json
      build-all.mjs, check-*.mjs, generate-registry.js
                                upstream monorepo tooling; they assume ../app and a registry.json
                                that do not exist here, so only the four scripts above are used
    .vscode/                  manifest JSON schema + editor settings
    .claude/rules/            architecture.md (and code-style.md)
  mma-plugins/                release copies, ready to drop into MMA (see its README)
```

## Flow

```text
src/  --build-->  index.js, procedure.js (next to manifest.json)
      --dev-->      %APPDATA%\app.map-making.local\plugins\<id>      (watch + sync)
      --package-->  tools/mma-plugins/<id>                           (release copy)

node sync.mjs builds every plugin and installs it into the MMA plugin folder. Add --release to
also refresh the release copies. Per-plugin `npm run package` still works on its own.
```

Every plugin folder is an npm package whose scripts call `../scaffold/...`, with the same scripts: `build`, `dev`, `package`, and
`test` where it has tests. Run `npm install` in a plugin folder first. `build-plugin.mjs` bumps the
manifest's patch version whenever a built artifact differs from git HEAD, so a rebuild after a
change edits `manifest.json`; commit that bump with the change.

The built `index.js` / `procedure.js` are committed, as upstream does.

## Per plugin

Each plugin folder has its own `README.md` (how it works and how to run it), `AGENTS.md` and
`CLAUDE.md` (layout of that plugin; `CLAUDE.md` only imports `AGENTS.md`). The release folder has a
short user-facing `README.md` per plugin.

## Conventions

- Target MMA 0.10.8 (`minAppVersion`). `types/mma.d.ts` describes a newer SDK; do not rely on
  shapes it has that 0.10.8 lacks (see the architecture rules).
- There are no MMA devtools. Plugins that need to be debugged surface state in their sidebar.
- Code style rules live in `.claude/rules/code-style.md`.
