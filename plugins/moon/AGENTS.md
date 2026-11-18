# Moon (id moon)

```text
manifest.json        id moon, display name "Moon", minAppVersion 0.10.8
src/index.ts         field defs (enum/number helpers), registerEnrichFields, two providers in a loop
src/procedure.ts     suncalc maths: GROUPS, DEFAULTS, configure, map, visibility, direction, phaseName
test/                node --test against the built procedure.js
index.js, procedure.js   built output (committed); do not edit
```

- The plugin id `moon` is also the installed folder name and the storage key; "Moon" is the display name.
- `configure` reads `cfg.config.group` ("position" or "visibility") and `cfg.fields`; `map` emits only
  fields that are both in the group and enabled.
- Visibility needs `extra.cloudCover`: the provider `requires` it, and the procedure also fails a row
  that lacks it (no cloud-blind verdict). Position fields never depend on it.
- Pointer reads `extra.moonAzimuth` / `extra.moonAltitude`; renaming them breaks Pointer.
- Dependency: `suncalc` (BSD-2-Clause) is bundled into `procedure.js`.
