# Weather+

Historical cloud cover (`cloudCover`, %) at each location's exact capture time, from ERA5. It is a
data-enrichment plugin only (no sidebar). It writes the same field key as the upstream Weather
plugin, so Moon's visibility reads either. Disable the upstream Weather plugin while this one is on.

## How it works

`src/procedure.ts` sends rows 5,000 at a time to the sidecar `sidecar/mma-weather-plus.exe lookup`,
which reads the values from Open-Meteo's public ERA5 bucket (`openmeteo.s3.amazonaws.com`) with HTTP
range requests. Nothing is downloaded in full or stored, and no API key or rate limit is involved.
Years up to 2023 come from `year_YYYY.om`, later data from 21-day `chunk_N.om` files. The nearest
0.25 degree cell is used, at the UTC hour of the capture time. Measured about 300 rows/s on a map with
many coverage years; 250k rows is roughly 15 minutes.

The sidecar prints one JSON line per row (`{id, cloudCover}` or `{id, error}`), then `{done: ...}`.
Rows without a usable time or coordinates, and rows newer than the archive, are failed. When the
nearest cell is sea it takes the nearest land cell of the 3x3 around it, as Open-Meteo's API does by
default. Against that API (`models=era5`) it matched 555 of 557 sampled Australian locations exactly;
the two misses were near Port Phillip Bay, where the API also weighs the point's own elevation.

## Run it

```powershell
npm install
npm test          # builds, then runs test/procedure.test.mjs (mocked host)
npm run build     # src/ -> index.js, procedure.js
npm run deploy    # build and copy the plugin and sidecar to %APPDATA%\app.map-making.local\plugins\weatherPlus
npm run package   # copy an installable plugin to tools/mma-plugins/weatherPlus
```

The sidecar must be built once before `deploy` or `package`. It needs Rust, MSYS2 gcc on PATH
(`C:\msys64\mingw64\bin`), git and Python:

```powershell
cd sidecar
node setup.mjs                 # one-time: gnu target, vendored C sources, libclang, .cargo/config.toml
cargo build --release          # -> target/x86_64-pc-windows-gnu/release/mma-weather-plus.exe
.\target\x86_64-pc-windows-gnu\release\mma-weather-plus.exe bench --n 2000
```

## License

The sidecar is GPL-2.0-only because it links `omfiles` and the om-file-format C library (both
GPL-2.0). Its source is `sidecar/`; the license text is `sidecar/LICENSE`.
