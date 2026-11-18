# MMA plugins: contributor guidance

Workspace for Map Making App (MMA) plugins. Read `docs/` for the architecture and
build flow, and `.claude/rules/` for the implementation and verification rules,
before changing plugin structure or host integration.

```text
plugins/<id>/   one npm package per plugin (manifest.json, src/, test/, sidecar/)
scaffold/       shared build, release and dev scripts, SDK typings
templates/      plugin templates for `just new` (basic, procedure, sidecar)
scripts/        task scripts (plugins.mjs, new-plugin.mjs) driven by the justfile
docs/           architecture and build flow
```

## Commands

Run from the repo root. Plugin ids are optional (default: all).

```powershell
just sync [plugin...]        # build and install into %APPDATA%\app.map-making.local\plugins\<id>
just dev [plugin...]         # watch and sync on every change until Ctrl+C
just test [plugin...]        # run plugin tests
just release [plugin...]     # build and assemble <plugin>/release/
just new <name> [template]   # create plugins/<name> from a template; asks when omitted
```

Per plugin: `npm run build`, `npm run dev`, `npm test`.

- `build/` (generated) is the complete runtime payload, including the compiled
  sidecar when the plugin has one. `release/` (generated) adds README and LICENSE.
- Close MMA before syncing a plugin whose sidecar exe is in use.

## Checklist

- Follow `.claude/rules/implementation.md` and `verification.md`.
- Never edit generated `build/` or `release/` output.
- Keep `docs/`, this file and the plugin's own docs in step with source changes.
