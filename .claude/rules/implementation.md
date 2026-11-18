# Implementation rules

Rules that apply to every plugin. Plugin-specific details belong in that
plugin's own `AGENTS.md` or README.

## Repository

- A plugin's id equals its folder name, storage namespace and sidecar key; do not
  change it.
- Shared build tooling lives in `scaffold/`; reference it as `../../scaffold/`,
  never copy it into a plugin.
- `build/` and `release/` are generated: change the source or the scripts, not
  the output. A plugin ships only what its `build/` contains.
- Create plugins with `just new` so they start from a template.

## Code structure

- Keep UI entry points thin. Logic that can be tested lives in `src/procedure.ts`
  or a module it imports, and is tested against the built procedure with a mocked
  `mma`.
- Target MMA 0.10.x (`minAppVersion` 0.10.8): do not rely on newer APIs.

## Host integration

- **Field definitions** use MMA 0.10's shape:
  `{ type, label, values: string[] | null, labels: [value, label][] | null, comparison }`.
  Do not use the newer `{ value, label }[]` shape from the SDK typings.
- **Enrichment toggles** require
  `registerEnrichFields([{ key, label, defaultOff? }])`.
- **Provider dependencies** are per provider, not per field. Register separate
  providers when only some fields need another enrichment.
- Two providers cannot own the same field key.
- Location fields are in `extra`; capture time is `extra.datetime` in Unix seconds.
- Storage is synchronous: `MMA.storage(id).get(key, default)` and `.set(key, value)`.
  Tolerate empty or failing storage.
- Anything that depends on MMA's DOM must degrade to nothing when the markup changes.

## Procedures

- Export `configure(cfg)` and `map(rows)`. Network procedures export
  `request(rows)` and `map(rows, response)`; sidecar procedures export `run(rows)`.
- Fail a row with `mma.fail(id)` rather than leaving it unanswered.
- The QuickJS guest has no DOM or Node APIs, and `TextDecoder` may be absent.

## Sidecars

- Commands listed in `manifest.sidecar.serve` are resident; the others are one-shot.
- Emit one JSON object per row on stdout and diagnostics on stderr.
- A sidecar line handler must not call `mma.sidecar` recursively.
- Keep `manifest.sidecar.version` and the crate version in step.
