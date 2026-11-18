// Builds every plugin and installs it into MMA's plugin folder.
//
//   node sync.mjs                  build + install everything
//   node sync.mjs --test           run each plugin's tests first (stops on a failure)
//   node sync.mjs moon pointer     only the named plugins
//
// What gets installed is each plugin's build/ folder, the same one that is zipped for a release.
// Close MMA first if it holds a sidecar exe open: Windows cannot overwrite it.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appData =
	process.platform === "win32"
		? join(process.env.APPDATA, "app.map-making.local")
		: process.platform === "darwin"
			? join(process.env.HOME, "Library", "Application Support", "app.map-making.local")
			: join(process.env.HOME, ".local", "share", "app.map-making.local");
const installRoot = join(appData, "plugins");

const args = process.argv.slice(2);
const withTests = args.includes("--test");
const bad = args.filter((a) => a.startsWith("--") && a !== "--test");
if (bad.length > 0) {
	console.error(`Unknown option(s): ${bad.join(", ")} (use --test)`);
	process.exit(1);
}
const only = args.filter((a) => !a.startsWith("--"));

const plugins = readdirSync(here)
	.filter((name) => {
		const dir = join(here, name);
		return (
			statSync(dir).isDirectory() &&
			existsSync(join(dir, "manifest.json")) &&
			existsSync(join(dir, "package.json"))
		);
	})
	.filter((name) => only.length === 0 || only.includes(name))
	.sort();

const unknown = only.filter((n) => !plugins.includes(n));
if (unknown.length > 0) {
	console.error(`Unknown plugin(s): ${unknown.join(", ")}`);
	process.exit(1);
}

function run(dir, command) {
	const r = spawnSync(command, { cwd: dir, stdio: "inherit", shell: true });
	if (r.status !== 0) throw new Error(`"${command}" failed in ${dir}`);
}

const done = [];
for (const name of plugins) {
	const dir = join(here, name);
	const scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts ?? {};
	console.log(`\n== ${name}`);
	try {
		if (!existsSync(join(dir, "node_modules"))) run(dir, "npm install");
		if (withTests && scripts.test) run(dir, "npm test");
		// `npm run build` is the full build (a plugin's test script may build only part of it).
		run(dir, "npm run build");

		const manifest = JSON.parse(readFileSync(join(dir, "build", "manifest.json"), "utf8"));
		const target = join(installRoot, manifest.id);
		mkdirSync(target, { recursive: true });
		cpSync(join(dir, "build"), target, { recursive: true });
		done.push(`${manifest.id} ${manifest.version}`);
		console.log(`[sync] ${manifest.id} -> ${target}`);
	} catch (e) {
		console.error(`\n[sync] ${name} failed: ${e.message}`);
		process.exit(1);
	}
}

console.log(`\nSynced ${done.length}: ${done.join(", ")}`);
console.log("Reload MMA (or restart it) to pick the changes up.");
