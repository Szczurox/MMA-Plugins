set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List the recipes.
default:
    @just --list

# Build plugins (Rust sidecars too; needs Rust and a C compiler) and install them into the local MMA plugins folder.
sync *plugins:
    node scripts/plugins.mjs sync {{plugins}}

# Run plugin tests, including each sidecar's Rust unit tests (needs Rust for plugins with a sidecar).
test *plugins:
    node scripts/plugins.mjs test {{plugins}}

# Build plugins, assemble <plugin>/release/ and zip into dist/ (plus the all-plugins bundle when no names are given).
package *plugins:
    node scripts/plugins.mjs release {{plugins}}
    node scripts/package.mjs {{plugins}}

# Release plugins whose version has no tag yet, by starting the Release workflow on GitHub (--dry-run to only check).
release *flags:
    node scripts/release.mjs {{flags}}

# Create plugins/<name> from a template in templates/ (asks which one when omitted).
new name template="":
    node scripts/new-plugin.mjs {{name}} {{template}}

# Watch plugins and sync them into MMA on every change (Ctrl+C to stop).
dev *plugins:
    node scripts/plugins.mjs dev {{plugins}}
