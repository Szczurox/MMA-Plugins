// Copies the finished plugin, including the native helper and its license, somewhere MMA or a
// release can use it. The shared package step only knows the manifest, index.js and the procedure.
//
//   node ship.mjs --install        into %APPDATA%\app.map-making.local\plugins\weatherPlus
//   node ship.mjs --release <dir>  into <dir>/weatherPlus (the release copy)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const args = process.argv.slice(2);

const exeName = `${manifest.sidecar.name}.exe`;
const exe = join(here, "sidecar", "target", "x86_64-pc-windows-gnu", "release", exeName);

function copyInto(dir) {
	mkdirSync(join(dir, "sidecar"), { recursive: true });
	for (const f of ["manifest.json", "index.js", "procedure.js"]) copyFileSync(join(here, f), join(dir, f));
	// The helper is GPL-2.0-only, so its license text travels with it.
	copyFileSync(join(here, "sidecar", "LICENSE"), join(dir, "LICENSE"));
	if (!existsSync(exe)) throw new Error(`${exe} not built; run cargo build --release in sidecar/`);
	copyFileSync(exe, join(dir, "sidecar", exeName));
	writeFileSync(join(dir, "sidecar", "version.txt"), manifest.sidecar.version);
	console.log(`[weatherPlus] shipped to ${dir}`);
}

if (args.includes("--install")) {
	copyInto(join(process.env.APPDATA, "app.map-making.local", "plugins", manifest.id));
}
const rel = args.indexOf("--release");
if (rel >= 0) copyInto(join(resolve(args[rel + 1]), manifest.id));
