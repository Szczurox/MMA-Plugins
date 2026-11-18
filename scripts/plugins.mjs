// Plugin tasks, normally run through the justfile.
//
//   node scripts/plugins.mjs sync    [plugin...]   build and install into MMA's plugin folder
//   node scripts/plugins.mjs test    [plugin...]   run each plugin's tests
//   node scripts/plugins.mjs release [plugin...]   build and assemble <plugin>/release/
//   node scripts/plugins.mjs dev     [plugin...]   watch and sync each plugin until Ctrl+C
//
// With no plugin names every plugin under plugins/ is used. Close MMA before syncing a plugin
// whose sidecar exe is in use: Windows cannot overwrite it.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releasePlugin } from "../scaffold/release-plugin.mjs";

const pluginsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const appData =
	process.platform === "win32"
		? join(process.env.APPDATA, "app.map-making.local")
		: process.platform === "darwin"
			? join(process.env.HOME, "Library", "Application Support", "app.map-making.local")
			: join(process.env.HOME, ".local", "share", "app.map-making.local");
const installRoot = join(appData, "plugins");

const [mode, ...only] = process.argv.slice(2);
if (!["sync", "test", "release", "dev"].includes(mode) || only.some((a) => a.startsWith("-"))) {
	console.error("Usage: node scripts/plugins.mjs <sync|test|release|dev> [plugin...]");
	process.exit(1);
}

const plugins = readdirSync(pluginsRoot)
	.filter((name) => {
		const dir = join(pluginsRoot, name);
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

if (mode === "dev") await dev();

async function dev() {
	for (const name of plugins) {
		const dir = join(pluginsRoot, name);
		if (!existsSync(join(dir, "node_modules"))) run(dir, "npm install");
	}
	const children = plugins.map((name) => {
		const child = spawn("npm run dev", {
			cwd: join(pluginsRoot, name),
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		for (const stream of [child.stdout, child.stderr]) {
			let tail = "";
			stream.on("data", (chunk) => {
				const lines = (tail + chunk).split(/\r?\n/);
				tail = lines.pop();
				for (const line of lines) if (line.trim()) console.log(`[${name}] ${line}`);
			});
		}
		return { name, child, exited: new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1))) };
	});

	// Ctrl+C reaches the children too (same console); this also covers a plain kill.
	const stop = () => {
		for (const { child } of children) {
			if (process.platform === "win32") spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
			else child.kill();
		}
	};
	process.on("SIGINT", () => {
		stop();
		process.exit(0);
	});
	process.on("exit", stop);

	console.log(`dev: watching ${plugins.join(", ")} (Ctrl+C to stop)`);
	const codes = await Promise.all(children.map((c) => c.exited));
	const failed = plugins.filter((_, i) => codes[i] !== 0);
	if (failed.length > 0) {
		console.error(`dev: ${failed.join(", ")} exited with an error`);
		process.exit(1);
	}
	process.exit(0);
}

const done = [];
for (const name of plugins) {
	const dir = join(pluginsRoot, name);
	const scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts ?? {};
	console.log(`\n== ${name}`);
	try {
		if (!existsSync(join(dir, "node_modules"))) run(dir, "npm install");

		if (mode === "test") {
			if (scripts.test) run(dir, "npm test");
			else console.log("(no tests)");
			done.push(name);
			continue;
		}

		// `npm run build` is the full build (a plugin's test script may build only part of it).
		run(dir, "npm run build");
		const manifest = JSON.parse(readFileSync(join(dir, "build", "manifest.json"), "utf8"));

		if (mode === "sync") {
			const target = join(installRoot, manifest.id);
			mkdirSync(target, { recursive: true });
			cpSync(join(dir, "build"), target, { recursive: true });
			console.log(`[sync] ${manifest.id} -> ${target}`);
		} else {
			const r = releasePlugin(dir);
			console.log(`[release] ${r.id} ${r.version} -> ${r.dir}`);
		}
		done.push(`${manifest.id} ${manifest.version}`);
	} catch (e) {
		console.error(`\n[${mode}] ${name} failed: ${e.message}`);
		process.exit(1);
	}
}

console.log(`\n${mode}: ${done.length} plugin(s): ${done.join(", ")}`);
if (mode === "sync") console.log("Reload MMA (or restart it) to pick the changes up.");
