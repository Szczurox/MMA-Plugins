# Verification rules

- After changing a plugin, run `just test <plugin>` and `just sync <plugin>`.
- After changing `scaffold/` or `scripts/`, run `just test` and `just sync` for
  all plugins.
- After changing `templates/`, run `just new` with each template, then test the
  result and delete it.
- After changing release behaviour, run `just package` and check `release/`
  contains what the manifest promises.
- `just test <plugin>` also runs the sidecar's Rust unit tests; sidecar changes
  additionally need `just sync <plugin>` (which builds the sidecar) and a check in MMA.
- MMA has no plugin devtools: surface diagnostics through a sidebar or `mma.log`.
- Keep docs in step with the flow: update `docs/` and `AGENTS.md` when recipes,
  layout or generated outputs change.
