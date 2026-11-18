import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [, , sourceArg, releaseRootArg] = process.argv;
if (!sourceArg || !releaseRootArg) {
	console.error("Usage: node package-plugin.mjs <plugin-directory> <release-root>");
	process.exit(1);
}

const source = resolve(sourceArg);
const manifestPath = join(source, "manifest.json");
if (!existsSync(manifestPath)) throw new Error(`No manifest.json in ${source}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const id = manifest.id || basename(source);
const destination = join(resolve(releaseRootArg), id);
mkdirSync(destination, { recursive: true });

for (const file of [
	manifestPath,
	join(source, manifest.main || "index.js"),
	...(manifest.procedure ? [join(source, manifest.procedure)] : []),
]) {
	if (!existsSync(file)) throw new Error(`Missing plugin artifact: ${file}`);
	copyFileSync(file, join(destination, basename(file)));
}

console.log(`[package] ${id} -> ${destination}`);
