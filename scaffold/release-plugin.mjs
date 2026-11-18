// Assembles a complete, distributable copy of a plugin in <plugin>/release/.
//
//   node scaffold/release-plugin.mjs <plugin-directory>
//
// Run it after the plugin has been built (sync.mjs --release does both). release/ is build/ plus
// LICENSE (the plugin's own, else the sidecar's), README.md and CHANGES.md, recreated from scratch
// each time.
// Fails when build/ lacks something the manifest promises, e.g. an unbuilt sidecar exe.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function releasePlugin(pluginDir) {
	const src = resolve(pluginDir);
	const build = join(src, "build");
	const manifestPath = join(build, "manifest.json");
	if (!existsSync(manifestPath)) throw new Error(`${src} has no build/; build it first`);

	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const sidecarExe = manifest.sidecar && join("sidecar", `${manifest.sidecar.name}.exe`);
	for (const file of [manifest.main || "index.js", manifest.procedure, sidecarExe].filter(Boolean)) {
		if (!existsSync(join(build, file))) throw new Error(`build/ is missing ${file}` + (file === sidecarExe ? " (build the sidecar: node setup.mjs && cargo build --release in sidecar/)" : ""));
	}

	const out = join(src, "release");
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	cpSync(build, out, { recursive: true });

	const license = [join(src, "LICENSE"), join(src, "sidecar", "LICENSE")].find(existsSync);
	if (license) copyFileSync(license, join(out, "LICENSE"));
	for (const doc of ["README.md", "CHANGES.md"]) {
		if (existsSync(join(src, doc))) copyFileSync(join(src, doc), join(out, doc));
	}

	return { id: manifest.id, version: manifest.version, dir: out };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const dir = process.argv[2];
	if (!dir) {
		console.error("Usage: node release-plugin.mjs <plugin-directory>");
		process.exit(1);
	}
	const r = releasePlugin(dir);
	console.log(`[release] ${r.id} ${r.version} -> ${r.dir}`);
}
