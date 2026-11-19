// Zips assembled releases into dist/.
//
//   node scripts/package.mjs [--platform <tag>] [plugin...]
//
// Expects plugins/<id>/release/ to exist (`just package` assembles it first),
// assembled for the same platform (this machine's unless --platform says otherwise).
// Writes dist/<id>-<version>-<platform>.zip for a plugin with a sidecar and dist/<id>-<version>.zip
// for the others; each zip has a top-level <id>/ folder, so it unzips straight into MMA's plugins
// folder. With no plugin names it also writes dist/mma-plugins-all-<platform>.zip, holding every
// plugin's folder.

import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, PLATFORM_TAGS, targetPlatform } from "../scaffold/platforms.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = join(root, "plugins");
const dist = join(root, "dist");
const stage = join(dist, ".stage");

/** bsdtar writes zips (`-a`); on Windows use the system one, since Git Bash's GNU tar cannot. */
export function zip(out, cwd, entries) {
	rmSync(out, { force: true });
	const absOut = resolve(out);
	const r =
		process.platform === "linux"
			? spawnSync("zip", ["-r", "-q", absOut, ...entries], {
					cwd,
					stdio: "inherit",
				})
			: spawnSync(
					process.platform === "win32"
						? join(process.env.SystemRoot, "System32", "tar.exe")
						: "tar",
					["-a", "-c", "-f", absOut, "-C", cwd, ...entries],
					{ stdio: "inherit" },
				);
	if (r.status !== 0) throw new Error(`could not create ${out}`);
}

/** The all-plugins bundle for a platform. */
export const bundleName = (platform) => `mma-plugins-all-${platform}.zip`;

function main() {
	const rest = process.argv.slice(2);
	const at = rest.indexOf("--platform");
	const only = rest.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
	if (only.some((a) => a.startsWith("-")) || (at >= 0 && !PLATFORMS[rest[at + 1]])) {
		console.error(`Usage: node scripts/package.mjs [--platform ${PLATFORM_TAGS.join("|")}] [plugin...]`);
		process.exit(1);
	}
	if (at >= 0) process.env.MMA_PLATFORM = rest[at + 1];
	const platform = targetPlatform();
	if (!platform) {
		console.error(`No platform for ${process.platform}-${process.arch}; pass --platform ${PLATFORM_TAGS.join("|")}`);
		process.exit(1);
	}

	const plugins = readdirSync(pluginsRoot)
		.filter(
			(name) =>
				existsSync(join(pluginsRoot, name, "manifest.json")) &&
				statSync(join(pluginsRoot, name)).isDirectory(),
		)
		.filter((name) => only.length === 0 || only.includes(name))
		.sort();
	const unknown = only.filter((n) => !plugins.includes(n));
	if (unknown.length > 0 || plugins.length === 0) {
		console.error(
			unknown.length > 0
				? `Unknown plugin(s): ${unknown.join(", ")}`
				: "No plugins found",
		);
		process.exit(1);
	}

	rmSync(stage, { recursive: true, force: true });
	mkdirSync(stage, { recursive: true });

	for (const name of plugins) {
		const release = join(pluginsRoot, name, "release");
		const manifestPath = join(release, "manifest.json");
		if (!existsSync(manifestPath)) {
			console.error(
				`plugins/${name}/release is missing; run "just package ${name}" instead`,
			);
			process.exit(1);
		}
		const { id, version, sidecar } = JSON.parse(readFileSync(manifestPath, "utf8"));
		cpSync(release, join(stage, id), { recursive: true });
		// A plugin with a native helper has one zip per platform; the others have a single zip.
		const out = join(dist, sidecar ? `${id}-${version}-${platform}.zip` : `${id}-${version}.zip`);
		zip(out, stage, [id]);
		console.log(`[package] ${out}`);
	}

	if (only.length === 0) {
		zip(join(dist, bundleName(platform)), stage, readdirSync(stage).sort());
		console.log(`[package] ${join(dist, bundleName(platform))}`);
	}
	rmSync(stage, { recursive: true, force: true });
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
	main();
