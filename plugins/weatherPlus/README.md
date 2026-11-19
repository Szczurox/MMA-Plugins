# Weather+

Historical cloud cover (`cloudCover`, %) at each location's exact capture time, worldwide, from two
model archives: ECMWF IFS (~9 km) from 2017-01-01 and ERA5 (0.25 degree, ~28 km) before that. It is
a data-enrichment plugin only (no sidebar). It writes the same field key as the upstream Weather
plugin, so Moon's visibility reads either. Disable the upstream Weather plugin while this one is on.

## How it works

`src/procedure.ts` sends rows 5,000 at a time to the sidecar `sidecar/mma-weather-plus.exe lookup`,
which reads the values from Open-Meteo's public bucket (`openmeteo.s3.amazonaws.com`) with HTTP
range requests. Nothing is downloaded in full or stored, and no API key or rate limit is involved.
The UTC hour of the capture time is used.

| Capture time         | Source                                  | Grid                          | Files                                            |
| -------------------- | --------------------------------------- | ----------------------------- | ------------------------------------------------ |
| 2017-01-01 and later | `data/ecmwf_ifs/cloud_cover` (IFS HRES) | O1280 reduced Gaussian, ~9 km | 21-day `chunk_N.om`, dims `[1, gridpoint, hour]` |
| before 2017          | `data/copernicus_era5/cloud_cover`      | regular 0.25 degree           | `year_YYYY.om` up to 2023, then `chunk_N.om`     |

IFS rows fall back to ERA5 when IFS has no value for that point and hour. The IFS archive is stitched
from short-range forecasts, so it is model output like ERA5, not an observation; the two tiers have
slightly different statistics around the 2017 boundary. Throughput is about 150 to 200 rows/s for IFS
(20k random global rows in 1m40s to 2m13s depending on the network, so 250k rows is roughly 20 to 28
minutes) and about 300 rows/s for ERA5.

The two land masks (`static/HSURF.om`, 0.4 MB for ERA5 and 2.4 MB for IFS) never change, so they are
downloaded once in a single GET and cached under the host's data dir (`weatherPlus-cache/`, or the
system temp dir when the host gives none). Later batches load them in about 0.1 s; without the cache
each 5,000-row batch would pay the download again.

The sidecar prints one JSON line per row (`{id, cloudCover}` or `{id, error}`), then
`{done, rows, reads, fellBack, requests}`. Rows without a usable time or coordinates, rows before
1940, and rows newer than the archive are failed. When the nearest cell is sea it takes the nearest
land cell of the 3x3 around it, as Open-Meteo's API does by default. Against the API's historical
forecast endpoint (`models=ecmwf_ifs`) it matched all 15 sampled worldwide points exactly (2019 and
2024). The earlier ERA5-only version matched 555 of 557 sampled Australian locations against
`models=era5`; the two misses were near Port Phillip Bay, where the API also weighs the point's own
elevation, which rows do not carry.

## Run it

```powershell
npm install
npm test          # builds, then runs test/procedure.test.mjs (mocked host)
npm run build     # src/ -> build/ (index.js, procedure.js, sidecar exe once it is built)
npm run dev       # watch and sync to %APPDATA%\app.map-making.local\plugins\weatherPlus
npm run release   # assemble the full release in release/
```

`just sync weatherPlus` and `just package weatherPlus` build the sidecar first, and `just test weatherPlus`
runs its offline unit tests (dates, O1280 grid, tiers, land snap). Run these from the repository root:

```powershell
just sync weatherPlus   # Windows: sidecar/target/x86_64-pc-windows-gnu/release/mma-weather-plus.exe
just test weatherPlus
.\plugins\weatherPlus\sidecar\target\x86_64-pc-windows-gnu\release\mma-weather-plus.exe bench --n 2000   # ERA5 only
```

Besides [Rust](https://rustup.rs) the build needs a C compiler, because the sidecar's file-format
library is C code:

- **Windows:** [MSYS2](https://www.msys2.org)'s MinGW gcc (`pacman -S mingw-w64-x86_64-gcc` in an MSYS2
  shell) and the GNU target, `rustup target add x86_64-pc-windows-gnu`. MSVC cannot compile this C code,
  which is why the GNU target is used; the build finds `C:\msys64\mingw64\bin` even when it is not
  on PATH and tells you what is missing.
- **Linux:** a C compiler, e.g. `apt install build-essential`. Binary: `target/release/mma-weather-plus`.
- **macOS:** Xcode's command line tools, `xcode-select --install`.

The library's Rust crate is vendored in `sidecar/vendor/` (see its README).
The first build downloads the crates and takes a minute or two; later ones are incremental.

Releases ship one archive per system (`weatherPlus-<version>-windows-x64.zip`, `-linux-x64.tar.gz`,
`-macos-arm64.tar.gz`), built by the Release workflow on each platform's own runner.

`inspect --file <url>` prints the dimensions of any remote `.om` file. When cell, hour or tier
selection changes, also compare a few worldwide points against the Open-Meteo API
(`historical-forecast-api.open-meteo.com`, `models=ecmwf_ifs`, hourly `cloud_cover`).

## License

The sidecar is GPL-2.0-only because it links `omfiles` and the om-file-format C library (both
GPL-2.0). Its source is `sidecar/`; the license text is `sidecar/LICENSE`.
