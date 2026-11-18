// Shared build script for all MMA plugins.
//
// Usage:
//   node scaffold/build-plugin.mjs <plugin>            # build one plugin
//   node scaffold/build-plugin.mjs <plugin> --watch    # watch mode
//   node scaffold/build-plugin.mjs                     # build all plugins
//
// Everything a plugin needs at runtime lands in <plugin>/build/, which is the folder to install or
// zip: the bundled UI (index.js), the enrichment procedure when the manifest names one, a copy of
// manifest.json, and NOTICE.md when the plugin has one. Plugins with more to ship (a native helper)
// add it to build/ themselves after this step.
//
// Auto-detects the UI entry point (src/index.tsx > src/index.ts) and applies JSX config only when
// needed. A plugin whose manifest names a `procedure` also gets that module bundled from
// src/procedure.ts.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// This script lives in <plugins>/scaffold; plugin folders are its siblings.
const pluginsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mmaExternals = createRequire(import.meta.url)("./mma-externals.js");

/** Files copied from the plugin folder into build/ unchanged. */
const STATIC_FILES = ["manifest.json", "NOTICE.md"];

export function resolveEsbuild(pluginDir) {
	return createRequire(join(pluginDir, "package.json"))("esbuild");
}

export function readManifest(pluginDir) {
	const path = join(pluginDir, "manifest.json");
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function buildDir(pluginDir) {
	return join(pluginDir, "build");
}

/** Each imported .css file becomes one <style> element, keyed by its path so a reload replaces it. */
function cssImports() {
	return {
		name: "mma-css",
		setup(build) {
			build.onLoad({ filter: /\.css$/ }, ({ path }) => {
				const key = JSON.stringify(relative(pluginsDir, path).split(sep).join("/"));
				const css = JSON.stringify(readFileSync(path, "utf8"));
				return {
					loader: "js",
					contents: `let style = [...document.head.querySelectorAll("style[data-mma-plugin-css]")].find((s) => s.dataset.mmaPluginCss === ${key});
if (!style) {
	style = document.createElement("style");
	style.dataset.mmaPluginCss = ${key};
	document.head.appendChild(style);
}
style.textContent = ${css};
`,
				};
			});
		},
	};
}

export function uiOpts(pluginDir) {
	const tsx = existsSync(join(pluginDir, "src/index.tsx"));
	const entry = tsx ? "src/index.tsx" : "src/index.ts";
	if (!existsSync(join(pluginDir, entry))) {
		throw new Error(`No entry point found in ${pluginDir} (tried src/index.tsx, src/index.ts)`);
	}

	const opts = {
		entryPoints: [join(pluginDir, entry)],
		bundle: true,
		format: "esm",
		outfile: join(buildDir(pluginDir), "index.js"),
		absWorkingDir: pluginsDir,
		preserveSymlinks: true,
		plugins: [mmaExternals(), cssImports()],
	};

	if (tsx) {
		opts.jsx = "automatic";
		opts.jsxImportSource = "react";
	}

	return opts;
}

/** Build options for the enrichment procedure the manifest names, or null without one. */
export function procedureOpts(pluginDir) {
	const file = readManifest(pluginDir)?.procedure;
	if (!file) return null;
	const entry = join(pluginDir, "src/procedure.ts");
	if (!existsSync(entry)) {
		throw new Error(`${pluginDir} declares a procedure but has no src/procedure.ts`);
	}
	return {
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		outfile: join(buildDir(pluginDir), file),
		// The guest is QuickJS: no node, no browser, no package conditions to match on.
		platform: "neutral",
		mainFields: ["module", "main"],
		target: "es2022",
		absWorkingDir: pluginsDir,
		preserveSymlinks: true,
		logLevel: "warning",
	};
}

/** Every esbuild target a plugin has: its UI bundle, plus its procedure when it ships one. */
export function allOpts(pluginDir) {
	return [uiOpts(pluginDir), procedureOpts(pluginDir)].filter(Boolean);
}

/** Copy the manifest (and NOTICE.md when present) into build/. */
export function copyStatic(pluginDir) {
	mkdirSync(buildDir(pluginDir), { recursive: true });
	for (const file of STATIC_FILES) {
		if (existsSync(join(pluginDir, file))) copyFileSync(join(pluginDir, file), join(buildDir(pluginDir), file));
	}
}

function discoverPlugins() {
	return readdirSync(pluginsDir)
		.map((name) => join(pluginsDir, name))
		.filter(
			(dir) =>
				statSync(dir).isDirectory() &&
				(existsSync(join(dir, "src/index.tsx")) || existsSync(join(dir, "src/index.ts"))) &&
				existsSync(join(dir, "manifest.json")),
		)
		.sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const watch = args.includes("--watch");
	if (args.some((arg) => arg.startsWith("--") && arg !== "--watch"))
		throw new Error("Unknown option; only --watch is accepted");
	const dirs = args.filter((a) => !a.startsWith("--"));

	const targets = dirs.length > 0 ? dirs.map((d) => resolve(d)) : discoverPlugins();

	if (watch) {
		for (const dir of targets) {
			const name = dir.slice(pluginsDir.length + 1);
			const { context } = resolveEsbuild(dir);
			copyStatic(dir);
			for (const opts of allOpts(dir)) await (await context(opts)).watch();
			console.log(`[${name}] watching`);
		}
	} else {
		const results = await Promise.allSettled(
			targets.map(async (dir) => {
				const name = dir.slice(pluginsDir.length + 1);
				const { build } = resolveEsbuild(dir);
				// A clean build folder, so nothing stale ends up in the zip.
				rmSync(buildDir(dir), { recursive: true, force: true });
				for (const o of allOpts(dir)) await build(o);
				copyStatic(dir);
				return name;
			}),
		);

		let failed = 0;
		for (const r of results) {
			if (r.status === "fulfilled") {
				console.log(`[${r.value}] ok`);
			} else {
				failed++;
				console.error(r.reason.message || r.reason);
			}
		}
		if (failed) process.exit(1);
	}
}
