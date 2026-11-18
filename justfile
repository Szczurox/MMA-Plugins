set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List the recipes.
default:
    @just --list

# Build plugins and install them into the local MMA plugins folder.
sync *plugins:
    node scripts/plugins.mjs sync {{plugins}}

# Run plugin tests.
test *plugins:
    node scripts/plugins.mjs test {{plugins}}

# Build plugins and assemble <plugin>/release/.
release *plugins:
    node scripts/plugins.mjs release {{plugins}}

# Build releases and zip them into dist/ (plus the all-plugins bundle when no names are given).
package *plugins: (release plugins)
    node scripts/package.mjs {{plugins}}

# Create plugins/<name> from a template in templates/ (asks which one when omitted).
new name template="":
    node scripts/new-plugin.mjs {{name}} {{template}}

# Watch plugins and sync them into MMA on every change (Ctrl+C to stop).
dev *plugins:
    node scripts/plugins.mjs dev {{plugins}}
