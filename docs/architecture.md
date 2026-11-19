# Plugin architecture

## Repository layout

This repository is the standalone MMA plugin workspace. Map JSON collections are
maintained outside it.

```text
MMA-Plugins/
  plugins/<id>/          one npm package per plugin
    manifest.json
    package.json
    tsconfig.json
    README.md
    CHANGES.md           per-version change log; feeds the release notes
    src/index.ts[x]      UI entry point
    src/procedure.ts     enrichment procedure, optional
    test/                procedure tests, optional
    sidecar/             Rust helper crate, optional
    build/               generated: installable runtime payload
    release/             generated: build/ + README + CHANGES.md + LICENSE
  scaffold/              shared build, release and dev scripts, SDK typings
  scripts/               repo task scripts driven by the justfile
  templates/             plugin templates used by `just new`
  justfile               sync, dev, test, release, package, publish and new recipes
  docs/                  this documentation
  .claude/rules/         implementation and verification rules
```

Each plugin is independent. Shared tooling lives in `scaffold/` and is never
copied into a plugin; plugin scripts reach it through `../../scaffold/`.
`build/` and `release/` are generated and ignored by git.

## What a plugin contains

| File                   | Role                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `manifest.json`        | `id`, metadata, version, `main`, optional `procedure`, `minAppVersion` and optional `sidecar` |
| `src/index.ts[x]`      | UI entry point; calls `MMA.registerPlugin`                                                    |
| `src/procedure.ts`     | Enrichment logic run in the host's QuickJS guest                                              |
| `test/*.test.mjs`      | Tests run against the built procedure with a mocked `mma`                                     |
| `sidecar/`             | Optional Rust crate; its binary ships as `sidecar/<name>.exe` (Windows) or `sidecar/<name>`   |
| `README.md`            | Documentation, added to `release/`                                                            |
| `CHANGES.md`           | `## <version>` entries, newest first; the entry for the released version is the release notes |
| `LICENSE`              | License, added to `release/` only (the plugin's own, else `sidecar/LICENSE`)                  |

The plugin id is also its folder name, storage namespace and sidecar key.
Never change it casually.

## Templates

`just new <name> [template]` copies a folder from `templates/` into
`plugins/<name>/`. The templates are `basic` (UI entry only), `procedure`
(adds a procedure and a test) and `sidecar` (a procedure that calls a minimal
Rust helper). Inside copied files and file names `__ID__`, `__TITLE__` and
`__SLUG__` are replaced with the plugin id, display name and kebab-case id.
A template's `template.json` holds the description shown in the menu and is
not copied. Each template ships an `AGENTS.md` (plus a `CLAUDE.md` that imports
it) describing the template's purpose and file structure; it is copied into
the new plugin as its own contributor guide, with TODOs to replace.
