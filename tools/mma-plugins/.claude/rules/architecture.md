# Plugin architecture

## What a plugin is

A plugin is a folder named after its `id`, containing:

| File | Role |
|---|---|
| `manifest.json` | `id`, `name`, `description`, `version`, `main`, optional `procedure`, `minAppVersion`, optional `sidecar` |
| `index.js` (from `src/index.ts[x]`) | UI side. Calls `MMA.registerPlugin({ sidebar?, activate })`; `activate` registers providers and enrichment fields |
| `procedure.js` (from `src/procedure.ts`) | Enrichment code run by the host in a QuickJS guest, not in the browser |
| `sidecar/<name>.exe` | Optional native helper, called from a procedure |

The id is the folder name, the storage namespace and the sidecar key. Never change it.

## Organisation rules

- One plugin per folder under `tools/dev/mma-plugins/`, each its own npm package (`build`, `dev`,
  `package`, `test`). Shared tooling stays in `scaffold/`; do not copy it into a plugin. Plugins reach it by relative
  path (`../scaffold/...` in `package.json` scripts and `file:../scaffold/types`, `tsconfig` `extends`/`include`).
- Keep logic that can be tested out of `index.ts`. Pure functions live in `procedure.ts` (or a module
  it imports) and are covered by `node --test` against the built `procedure.js` with a mocked `mma`.
- A plugin ships only what MMA loads. The shared package step copies only the manifest, `index.js` and the
  procedure; anything more (a sidecar exe, a license) needs its own small step, as in
  `weatherPlus/ship.mjs`. The manifest names one procedure; a plugin has one procedure module.
- Release copies in `tools/mma-plugins/<id>/` are produced by `npm run package`, never edited by hand,
  except the short `README.md` / `LICENSE` that sit beside them.

## Key constraints (MMA 0.10.8)

- **Field definitions** use the 0.10 shape: `{ type, label, values: string[] | null,
  labels: [value, label][] | null, comparison }`. The `{ value, label }[]` shape from `mma.d.ts`
  turns dropdown filters into text boxes.
- **Enrichment toggles**: a field only appears in the Enrichment tab if listed in
  `registerEnrichFields([{ key, label, defaultOff? }])`.
- **`requires` is per provider, not per field.** To make one field depend on another (Moon visibility
  needs cloud cover, Moon position does not), register separate providers and share one procedure,
  telling them apart with `procedure.config`.
- **Two providers cannot own the same field key.** Weather+ uses the same `cloudCover`
  key as the upstream Weather plugin, so that plugin must be disabled while Weather+ is on.
- **Procedure contract**: `export configure(cfg)` (`{ fields, force, config }`) then
  `map(rows)` returning `[{ id, patch: { extra: {...} } }]`. Network procedures export
  `request(rows) -> { method, url }` and `map(rows, response)`. Sidecar procedures export
  `run(rows)`. Fail a row with `mma.fail(id)`; never leave it silently unanswered.
- **The guest is QuickJS**: no DOM, no node, and `TextDecoder` may be missing. esbuild builds it with
  `platform: "neutral"`.
- **Sidecars**: commands listed in `manifest.sidecar.serve` go to a resident process; others run as a
  one-shot child. A line handler passed to `mma.sidecar` cannot call `mma.sidecar` again. The sidecar
  prints one JSON object per row on stdout; stderr goes to MMA's sidecar log.
- **No viewer API.** Anything in the Street View viewer is done by DOM (Pointer clones the screenshot
  button's control) and must degrade to "absent", never to a broken button.
- **Storage**: `MMA.storage(id).get(key, default)` / `.set(key, value)`, synchronous. Wrap reads that
  can fail; a plugin must work with empty storage.
- **Data**: location fields live in `extra`; the capture time is `extra.datetime` in unix seconds.

## Verifying

- No devtools: expose state in the sidebar (Pointer's Status section) or `mma.log`.
- Always run `npm test` and `npm run build` before packaging.
- Rebuilding bumps the manifest patch version when artifacts changed; keep that bump.
- Sidecar changes also need a `cargo build --release` and an in-app run; the unit tests mock the host.
