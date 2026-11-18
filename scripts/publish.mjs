// Publishes GitHub releases from this machine.
//
//   node scripts/publish.mjs [--dry-run] [--yes]
//
// A plugin is released when no git tag <id>-v<version> exists yet, so the flow is: bump `version`
// in plugins/<id>/manifest.json, add a `## <version>` entry to plugins/<id>/CHANGES.md, commit and
// push to main, then run this. For each new version it creates a release (tag <id>-v<version>,
// asset <id>-<version>.zip, notes taken from that CHANGES.md entry). It then recreates the rolling
// "bundle" release holding mma-plugins-all.zip with every plugin at its current version.
//
// Checks first: on main, clean tree, everything pushed, gh installed and logged in, a CHANGES.md
// entry for every new version, and a sidecar exe that is built and not older than its sources.
// --dry-run only reports the plan and problems. --yes skips the confirmation prompt.
// Needs the GitHub CLI (https://cli.github.com), logged in with `gh auth login`.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { sidecarExe } from "../scaffold/build-plugin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = join(root, "plugins");
const dist = join(root, "dist");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");
const bad = args.filter((a) => !["--dry-run", "--yes"].includes(a));
if (bad.length > 0) {
	console.error(`Unknown argument(s): ${bad.join(", ")}\nUsage: node scripts/publish.mjs [--dry-run] [--yes]`);
	process.exit(1);
}

function git(...a) {
	return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function gitTry(...a) {
	try {
		return git(...a);
	} catch {
		return null;
	}
}
function gh(a) {
	return execFileSync("gh", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** The body of the `## <version>` section of a CHANGES.md, or null when there is none. */
export function changesFor(text, version) {
	const lines = text.split(/\r?\n/);
	const head = new RegExp(`^##\\s+v?${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
	const start = lines.findIndex((l) => head.test(l));
	if (start < 0) return null;
	let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
	if (end < 0) end = lines.length;
	return lines.slice(start + 1, end).join("\n").trim() || null;
}

function newestMtime(path) {
	if (!existsSync(path)) return 0;
	if (!statSync(path).isDirectory()) return statSync(path).mtimeMs;
	return Math.max(0, ...readdirSync(path).map((n) => newestMtime(join(path, n))));
}

// --- Checks ---------------------------------------------------------------------------------
const problems = [];
const problem = (m) => problems.push(m);

gitTry("fetch", "--tags", "--quiet");
const branch = gitTry("branch", "--show-current");
if (branch !== "main") problem(`on branch "${branch}"; releases are made from main`);
if (git("status", "--porcelain")) problem("the working tree has uncommitted or untracked changes");
const ahead = gitTry("rev-list", "--count", "@{u}..HEAD");
if (ahead === null) problem("the branch has no upstream; push it first");
else if (ahead !== "0") problem(`${ahead} commit(s) are not pushed yet`);
if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
	problem("the GitHub CLI is not installed or not logged in (https://cli.github.com, then `gh auth login`)");
}

// --- Plan -----------------------------------------------------------------------------------
const plugins = readdirSync(pluginsRoot)
	.filter((n) => statSync(join(pluginsRoot, n)).isDirectory() && existsSync(join(pluginsRoot, n, "manifest.json")))
	.sort()
	.map((folder) => {
		const dir = join(pluginsRoot, folder);
		const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
		const tag = `${m.id}-v${m.version}`;
		const tags = (gitTry("tag", "--list", `${m.id}-v*`, "--sort=-v:refname") ?? "").split("\n").filter(Boolean);
		const p = { id: m.id, folder, name: m.name, version: m.version, tag, bumped: !tags.includes(tag), previousTag: tags[0] ?? null, notes: null, sidecar: m.sidecar ?? null };

		if (p.bumped) {
			const file = join(dir, "CHANGES.md");
			if (!existsSync(file)) problem(`${m.id}: plugins/${folder}/CHANGES.md is missing`);
			else {
				p.notes = changesFor(readFileSync(file, "utf8"), m.version);
				if (!p.notes) problem(`${m.id}: CHANGES.md has no "## ${m.version}" entry with content`);
			}
		}
		if (m.sidecar) {
			const exe = sidecarExe(dir, m.sidecar.name);
			if (!exe) problem(`${m.id}: ${m.sidecar.name}.exe is not built (cargo build --release in plugins/${folder}/sidecar)`);
			else {
				const sources = Math.max(newestMtime(join(dir, "sidecar", "src")), newestMtime(join(dir, "sidecar", "Cargo.toml")), newestMtime(join(dir, "sidecar", "Cargo.lock")));
				if (sources > statSync(exe).mtimeMs) problem(`${m.id}: sidecar sources are newer than the built exe; run cargo build --release`);
			}
		}
		return p;
	});

const bumped = plugins.filter((p) => p.bumped);
console.log("Plugins:");
for (const p of plugins) console.log(`  ${p.bumped ? "RELEASE" : "up to date"}  ${p.id} ${p.version}${p.bumped ? `  -> ${p.tag}` : ""}`);

if (problems.length > 0) {
	console.error(`\n${problems.length} problem(s):\n${problems.map((m) => `  - ${m}`).join("\n")}`);
	process.exit(1);
}
if (bumped.length === 0) {
	console.log("\nNothing to release: every plugin's version already has a tag.");
	process.exit(0);
}
if (dryRun) {
	console.log("\nDry run: all checks passed, nothing was built or published.");
	process.exit(0);
}

if (!yes) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = (await rl.question(`\nBuild and publish ${bumped.length} release(s) plus the "bundle" release? [y/N] `)).trim().toLowerCase();
	rl.close();
	if (answer !== "y" && answer !== "yes") {
		console.log("Cancelled.");
		process.exit(0);
	}
}

// --- Build and zip every plugin -------------------------------------------------------------
for (const script of ["plugins.mjs release", "package.mjs"]) {
	const [file, ...rest] = script.split(" ");
	const r = spawnSync("node", [join("scripts", file), ...rest], { cwd: root, stdio: "inherit" });
	if (r.status !== 0) {
		console.error(`\n${script} failed; nothing was published.`);
		process.exit(1);
	}
}

// --- Publish --------------------------------------------------------------------------------
const sha = git("rev-parse", "HEAD");
const repo = (git("remote", "get-url", "origin").match(/github\.com[:/](.+?)(?:\.git)?$/) ?? [])[1];
const notesDir = mkdtempSync(join(tmpdir(), "notes-"));
const notesFile = (name, text) => {
	const file = join(notesDir, name);
	writeFileSync(file, text);
	return file;
};
const INSTALL =
	"Unzip into `%APPDATA%\\app.map-making.local\\plugins\\` so that `plugins\\<id>\\manifest.json` exists, then reload MMA.";

for (const p of bumped) {
	let notes = `## ${p.name} ${p.version}\n\n${p.notes}\n\n${INSTALL}\n`;
	if (p.sidecar && repo) {
		notes += `\nIncludes the GPL-2.0-only native helper \`${p.sidecar.name}\`; its source is at https://github.com/${repo}/tree/${p.tag}/plugins/${p.folder}/sidecar\n`;
	}
	gh([
		"release", "create", p.tag,
		join(dist, `${p.id}-${p.version}.zip`),
		"--target", sha,
		"--title", `${p.name} ${p.version}`,
		"--notes-file", notesFile(`${p.id}.md`, notes),
		"--latest=false",
	]);
	console.log(`[publish] ${p.tag}`);
}

try {
	gh(["release", "delete", "bundle", "--cleanup-tag", "--yes"]);
} catch {
	// No earlier bundle release.
}
const table = plugins.map((p) => `| ${p.name} | ${p.version} |`).join("\n");
gh([
	"release", "create", "bundle",
	join(dist, "mma-plugins-all.zip"),
	"--target", sha,
	"--title", "Bundle (all plugins)",
	"--notes-file", notesFile("bundle.md", `Every plugin at its current version.\n\n| Plugin | Version |\n| --- | --- |\n${table}\n\n${INSTALL}\n`),
	"--latest",
]);
console.log("[publish] bundle");
if (repo) console.log(`\nDone: https://github.com/${repo}/releases`);
