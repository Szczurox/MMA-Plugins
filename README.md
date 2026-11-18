# MMA plugins

Plugins for [Map Making App](https://github.com/ccmdi/mma).

## Plugins

| Plugin       | Purpose                                                          | Source                                         |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| **Moon**     | Moon direction, altitude, phase and visibility for each location | [`plugins/moon/`](plugins/moon/)               |
| **Pointer**  | Street View controls for pointing at (panning to) things         | [`plugins/pointer/`](plugins/pointer/)         |
| **Weather+** | Historical ERA5 cloud cover at a location's capture time         | [`plugins/weatherPlus/`](plugins/weatherPlus/) |

Each plugin contains its own `README.md` that goes into more detail.

## Development

Tasks run from the repository root with [just](https://github.com/casey/just)
and Node.js. A plugin's dependencies install automatically the first time a
recipe touches it.

```powershell
just sync [plugin...]        # build and install into %APPDATA%\app.map-making.local\plugins\<id>
just dev [plugin...]         # watch and sync on every change until Ctrl+C
just test [plugin...]        # run plugin tests
just release [plugin...]     # build and assemble <plugin>/release/
just package [plugin...]     # release, then zip into dist/ (plus the all-plugins bundle when no names)
just new <name> [template]   # create plugins/<name> from templates/ (basic, procedure, sidecar)
```

Plugin names are optional; without them a recipe covers every plugin, so
`just sync moon pointer` syncs only those two. Reload MMA after a sync, and
close it first if a plugin's sidecar executable is in use.

A single plugin can also be driven from its own folder with `npm run build`,
`npm test` or `npm run dev`. `build/` is the installable payload and `release/`
adds the README and LICENSE for distribution; both are generated and ignored
by git. See [docs/](docs/) for the architecture and build flow.
