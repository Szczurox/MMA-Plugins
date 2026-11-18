# Pointer

Adds a "Point to ..." button to the Street View viewer, beside the screenshot button. The
Pointer sidebar picks the target: Road (the location's stored heading) or Moon (needs the
Moon plugin and enriched `moonAzimuth` / `moonAltitude`). The button is hidden when the
open location has no data for the target.

## How it works

MMA has no API for viewer buttons, so the button is a copy of the screenshot button's control
entry, found by its "screenshot" label and inserted as its left sibling. A MutationObserver plus a
500 ms poll keep it in place as the viewer re-renders. Clicking calls
`getPanorama().setPov({ heading, pitch })`. The open location comes from
`getMapState().activeLocation`. If MMA changes the label or markup the button stops appearing; the
sidebar's Status section shows whether the camera control, location, data and screenshot button were
found.

## Run it

```powershell
npm install
npm run build
npm run dev       # watch and sync to %APPDATA%\app.map-making.local\plugins\pointer
npm run release   # assemble the full release in release/
```

There are no tests: the plugin is DOM glue and is checked in the app.
