# Weather+ (weatherPlus)

```text
manifest.json        id weatherPlus, minAppVersion 0.10.2, procedure procedure.js, sidecar mma-weather-plus 0.1.0
src/index.ts         registers the cloudCover field and one provider (no sidebar)
src/procedure.ts     run(rows) -> mma.sidecar("weatherPlus", "lookup", ...); fails unanswered rows
test/                procedure.test.mjs with a mocked host and sidecar
sidecar/             Rust crate, GPL-2.0-only
  src/main.rs          CLI: lookup, inspect, bench; tolerates extra host args
  src/lookup.rs        row pipeline: validate, pick the tier, read, fall back, JSON-lines output
  src/ifs.rs           IFS O1280 grid math, nearest/land-snapped grid point, chunk key (from 2017)
  src/era5.rs          ERA5 0.25 degree cell, land snap, year/chunk file key
  src/model.rs         Row, Source (file URLs) and Key shared by the modules
  src/reader.rs        opens each needed remote file once, parallel single-value range reads
  src/statics.rs       land masks: one GET, cached on disk (host data dir or temp)
  src/time.rs          calendar helpers (no date crate)
  src/http.rs          OmFileReaderBackend over HTTP range requests, plus an in-memory backend
  Unit tests live next to the code in each module (run by `just test weatherPlus`, no network).
  LICENSE              GPL-2.0 text
```

- Only `cloudCover` is supported; other variables and the Open-Meteo API provider were removed on purpose.
- The provider id `weatherPlus` and field key `cloudCover` are what Moon visibility relies on.
- `just sync` and `just package` compile the sidecar first, so `build/` includes it (`just dev` and a bare
  `npm run build` reuse the last compiled one and warn when there is none).
- Sidecar builds (`scripts/sidecar.mjs`, called by those recipes) are plain `cargo` with local Rust
  and a C compiler. On Windows they target `x86_64-pc-windows-gnu` with MSYS2's MinGW gcc (MSVC cannot
  compile the C library); see `docs/build-flow.md` for the prerequisites on each platform.
- `sidecar/vendor/om-file-format-sys` is a vendored copy of the C library's Rust crate: its sources are
  real files (upstream uses a git symlink that Windows cannot check out) and its bindings are committed
  (`src/bindings.rs`), so no libclang or setup script is needed. The sidecar's `Cargo.toml` patches
  the git dependency to it. When `omfiles` moves to a newer `om-file-format` rev, update the copy as
  described in `sidecar/vendor/README.md`. It stays in the repo and out of `.gitignore`.
- MMA runs sidecars on `windows-x64`, `linux-x64` and `macos-arm64` only. The binary is
  `mma-weather-plus.exe` on Windows and `mma-weather-plus` elsewhere; the Release workflow builds and
  tests all three. Keep the crate portable: no Windows-only or Unix-only APIs without a `cfg`.
- If the sidecar version in the manifest changes, change `sidecar/Cargo.toml` too.
- Two tiers by capture time: ECMWF IFS (O1280 grid, `ecmwf_ifs`) from 2017-01-01 UTC, ERA5 before,
  with ERA5 as the fallback for IFS rows without a value. The O1280 index math mirrors Open-Meteo's
  `GaussianGrid.swift`; do not change it without the tests below.
- Sidecar tests: `just test weatherPlus` (offline). After changing cell, hour or tier selection,
  also spot-check a few worldwide points against the Open-Meteo API (`models=ecmwf_ifs`); the
  sidecar matched 15 of 15 when the IFS tier was added.
