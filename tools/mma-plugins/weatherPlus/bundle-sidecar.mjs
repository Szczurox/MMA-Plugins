// Adds the native helper and its license to build/, next to what the shared build produced.
// Run after `scaffold/build-plugin.mjs`; fails when the helper has not been built.
//
//   cd sidecar && node setup.mjs && cargo build --release

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const out = join(here, "build");

const exeName = `${manifest.sidecar.name}.exe`;
const exe = join(here, "sidecar", "target", "x86_64-pc-windows-gnu", "release", exeName);
if (!existsSync(exe)) {
	console.error(`[weatherPlus] ${exe} not found; build it first: cd sidecar && node setup.mjs && cargo build --release`);
	process.exit(1);
}

mkdirSync(join(out, "sidecar"), { recursive: true });
copyFileSync(exe, join(out, "sidecar", exeName));
writeFileSync(join(out, "sidecar", "version.txt"), manifest.sidecar.version);
// The helper is GPL-2.0-only, so its license text travels with it.
copyFileSync(join(here, "sidecar", "LICENSE"), join(out, "LICENSE"));
console.log("[weatherPlus] sidecar bundled");
