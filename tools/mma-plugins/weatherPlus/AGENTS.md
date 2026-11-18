# Weather+ (weatherPlus)

```text
manifest.json        id weatherPlus, minAppVersion 0.10.2, procedure procedure.js, sidecar mma-weather-plus 0.1.0
src/index.ts         registers the cloudCover field and one provider (no sidebar)
src/procedure.ts     run(rows) -> mma.sidecar("weatherPlus", "lookup", ...); fails unanswered rows
ship.mjs             --install / --release <dir>: copies manifest, index.js, procedure.js, LICENSE, sidecar exe + version.txt
test/                procedure.test.mjs with a mocked host and sidecar
sidecar/             Rust crate, GPL-2.0-only
  src/main.rs          CLI: lookup, inspect, bench; tolerates extra host args
  src/lookup.rs        file selection, land snap, parallel range reads, JSON-lines output
  src/http.rs          OmFileReaderBackend over HTTP range requests
  setup.mjs            one-time toolchain setup (writes .cargo/config.toml; vendor/ and .cargo/ are gitignored)
  LICENSE              GPL-2.0 text
index.js, procedure.js   built output (committed); do not edit
```

- Only `cloudCover` is supported; other variables and the Open-Meteo API provider were removed on purpose.
- The provider id `weatherPlus` and field key `cloudCover` are what Moon visibility relies on.
- `package` and `deploy` need the built sidecar exe; they fail loudly without it.
- Sidecar builds use the `x86_64-pc-windows-gnu` target (MSVC cannot compile the C library).
- If the sidecar version in the manifest changes, change `sidecar/Cargo.toml` too.
- The sidecar's values were validated against the Open-Meteo API (`models=era5`); re-validate after
  changing cell or hour selection in `lookup.rs`.
