# Moon

Moon direction, altitude, phase and daytime visibility for each location, computed from its exact
capture time with [SunCalc](https://github.com/mourner/suncalc). No network.

## How it works

Two providers share one procedure (`src/procedure.ts`), selected by `procedure.config.group`:

- **Moon** (`moon`, needs `datetime`): `moonPhase`, `moonIllumination`, `moonDirection`,
  `moonAzimuth`, `moonAltitude`.
- **Moon visibility** (`moonVisibility`, needs `datetime` and `cloudCover`): a verdict from altitude,
  illumination, elongation from the sun and cloud cover.

So position fields can be re-enriched without touching weather, while visibility waits for cloud
cover from Weather or Weather+. Thresholds are the `DEFAULTS` in the procedure. Phase and direction
are dropdown filters; all fields are toggles in the Enrichment tab.

## Run it

```powershell
npm install
npm test           # builds, then runs test/procedure.test.mjs
npm run build      # src/ -> build/ (index.js, procedure.js)
npm run dev        # watch and sync to %APPDATA%\app.map-making.local\plugins\moon
npm run release    # assemble the full release in release/
```
