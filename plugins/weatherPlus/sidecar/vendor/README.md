# Vendored dependencies

Will get changed removed in the future

## om-file-format-sys

A copy of `rust/om-file-format-sys` and the C library it wraps from
[open-meteo/om-file-format](https://github.com/open-meteo/om-file-format), rev
`d8855e418e2231ae8439f0c7e840fa3f93b371e3` (the rev `rust-omfiles` pins in `Cargo.lock`), GPL-2.0-only
(`LICENSE`). `Cargo.toml` of the sidecar points the git dependency at this copy with `[patch]`.

Why it is vendored, and what differs from upstream:

- **The C sources are real files in `c/`.** Upstream reaches them through a git symlink
  (`rust/om-file-format-sys/c -> ../../c`), which Windows checks out as a one-line text file, so the
  crate cannot be built from a Windows checkout otherwise.
- **The Rust bindings are committed (`src/bindings.rs`).** Upstream runs `bindgen` in `build.rs`,
  which needs libclang. Here `bindgen` is only built with `--features regenerate-bindings`, so
  building the sidecar needs a C compiler but nothing else. The file covers only the library's own
  headers, which use fixed-width types, so it is the same on Windows, Linux and macOS.
- `build.rs` and `Cargo.toml` carry those two changes and nothing else; `c/` is untouched.

### Updating it

When `omfiles` moves to a newer `om-file-format` rev:

1. Copy `c/` from the new rev over `om-file-format-sys/c/`, and take its `build.rs`, `Cargo.toml` and
   `src/lib.rs`, re-applying the two changes above.
2. Regenerate the bindings (needs libclang, and `rustfmt` for readable output), from
   `om-file-format-sys/`: `cargo build --features regenerate-bindings`.
3. Update the rev in this file and in the comment in `../Cargo.toml`, then run `just sidecar-test`
   and `just sidecar`, and check a few lookups against the Open-Meteo API.
