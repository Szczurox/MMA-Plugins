# Verification rules

- After changing a plugin, run `just test <plugin>` and `just sync <plugin>`.
- After changing `scaffold/` or `scripts/`, run `just test` and `just sync` for
  all plugins.
- After changing `templates/`, run `just new` with each template, then test the
  result and delete it.
- After changing release behaviour, run `just release` and check `release/`
  contains what the manifest promises.
- Sidecar changes also need `cargo build --release` in the plugin's `sidecar/`
  and a check in MMA.
- MMA has no plugin devtools: surface diagnostics through a sidebar or `mma.log`.
- Keep docs in step with the flow: update `docs/` and `AGENTS.md` when recipes,
  layout or generated outputs change.
