# MMA plugins

Plugins for [Map Making App](https://github.com/ccmdi/mma).

## Plugins

| Plugin                               | Purpose                             | Download                                                                                 |
| ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| **[Moon](plugins/moon/)**            | Moon position, phase and visibility | [Download](https://github.com/Szczurox/Geoguessr/releases?q=moon-v&expanded=true)        |
| **[Pointer](plugins/pointer/)**      | Pan Street View to a target         | [Download](https://github.com/Szczurox/Geoguessr/releases?q=pointer-v&expanded=true)     |
| **[Weather+](plugins/weatherPlus/)** | Historical cloud cover (IFS, ERA5)  | [Download](https://github.com/Szczurox/Geoguessr/releases?q=weatherPlus-v&expanded=true) |
|                                      |                                     |                                                                                          |
| **Bundle**                           | **All plugins in one zip**          | **[Download](https://github.com/Szczurox/Geoguessr/releases/tag/bundle)**                |

Each plugin has its own `README.md`; Download opens its releases, newest first.

## Development

Tasks run from the repository root with [just](https://github.com/casey/just)
and Node.js. A plugin's dependencies install automatically the first time a
recipe touches it.

```powershell
just sync [plugin...]         # build (Rust sidecar included) and install into %APPDATA%\app.map-making.local\plugins\<id>
just dev [plugin...]          # watch and sync on every change until Ctrl+C (uses the last built sidecar)
just test [plugin...]         # run plugin tests, including each sidecar's Rust unit tests
just package [plugin...]      # build, assemble <plugin>/release/ and zip into dist/ (per platform for plugins with a sidecar)
just publish [--dry-run]      # start the Release workflow by hand (a push to main starts it automatically)
just new <name> [template]    # create plugins/<name> from templates/ (basic, procedure, sidecar)
```

Plugin names are optional; without them a recipe covers every plugin, so
`just sync moon pointer` syncs only those two. Reload MMA after a sync, and
close it first if a plugin's sidecar executable is in use.

A single plugin can also be driven from its own folder with `npm run build`,
`npm test` or `npm run dev`. `build/` is the installable payload and `release/`
adds the README, CHANGES.md and LICENSE for distribution; both are generated and
ignored by git.
