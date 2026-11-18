// Zips assembled releases into dist/.
//
//   node scripts/package.mjs [plugin...]
//
// Expects plugins/<id>/release/ to exist (run `just release` first; `just package` does both).
// Writes dist/<id>-<version>.zip for each plugin; each zip has a top-level <id>/ folder, so it
// unzips straight into MMA's plugins folder. With no plugin names it also writes
// dist/mma-plugins-all.zip, holding every plugin's folder.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = join(root, "plugins");
const dist = join(root, "dist");
const stage = join(dist, ".stage");
export const BUNDLE = "mma-plugins-all.zip";

/** bsdtar writes zips (`-a`); on Windows use the system one, since Git Bash's GNU tar cannot. */
export function zip(out, cwd, entries) {
	rmSync(out, { force: true });
	const absOut = resolve(out);
	const r =
		process.platform === "linux"
			? spawnSync("zip", ["-r", "-q", absOut, ...entries], { cwd, stdio: "inherit" })
			: spawnSync(
					process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar",
					["-a", "-c", "-f", absOut, "-C", cwd, ...entries],
					{ stdio: "inherit" },
				);
	if (r.status !== 0) throw new Error(`could not create ${out}`);
}

/** Extract one member of a zip into dir. */
export function unzipMember(zipFile, dir, member) {
	mkdirSync(dir, { recursive: true });
	const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
	const r = spawnSync(tar, ["-x", "-f", resolve(zipFile), "-C", dir, member], { stdio: "inherit" });
	if (r.status !== 0) throw new Error(`could not extract ${member} from ${zipFile}`);
}

function main() {
	const only = process.argv.slice(2);
	if (only.some((a) => a.startsWith("-"))) {
		console.error("Usage: node scripts/package.mjs [plugin...]");
		process.exit(1);
	}

	const plugins = readdirSync(pluginsRoot)
		.filter((name) => existsSync(join(pluginsRoot, name, "manifest.json")) && statSync(join(pluginsRoot, name)).isDirectory())
		.filter((name) => only.length === 0 || only.includes(name))
		.sort();
	const unknown = only.filter((n) => !plugins.includes(n));
	if (unknown.length > 0 || plugins.length === 0) {
		console.error(unknown.length > 0 ? `Unknown plugin(s): ${unknown.join(", ")}` : "No plugins found");
		process.exit(1);
	}

	rmSync(stage, { recursive: true, force: true });
	mkdirSync(stage, { recursive: true });

	for (const name of plugins) {
		const release = join(pluginsRoot, name, "release");
		const manifestPath = join(release, "manifest.json");
		if (!existsSync(manifestPath)) {
			console.error(`plugins/${name}/release is missing; run "just release ${name}" first`);
			process.exit(1);
		}
		const { id, version } = JSON.parse(readFileSync(manifestPath, "utf8"));
		cpSync(release, join(stage, id), { recursive: true });
		const out = join(dist, `${id}-${version}.zip`);
		zip(out, stage, [id]);
		console.log(`[package] ${out}`);
	}

	if (only.length === 0) {
		zip(join(dist, BUNDLE), stage, readdirSync(stage).sort());
		console.log(`[package] ${join(dist, BUNDLE)}`);
	}
	rmSync(stage, { recursive: true, force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
