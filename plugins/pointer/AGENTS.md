# Pointer

```text
manifest.json    id pointer, minAppVersion 0.10.8, no procedure
src/index.tsx    everything: TARGETS, availableTargets, button cloning, sync loop, sidebar + Status
```

- `TARGETS`: `road` (`loc.heading`, pitch 0) and `moon` (`extra.moonAzimuth` / `extra.moonAltitude`).
  Moon is offered only when the `moon` plugin is installed.
- `controlUnit(shot)` climbs from the screenshot button to the wrapper that is its own control entry;
  `makeButton` deep-clones it, strips ids and replaces the icon. All label attributes are rewritten to
  "Point to <target>".
- The target choice is stored with `storage("pointer")`.
- Targets MMA 0.10.8 only: no fallback for newer viewer internals.
