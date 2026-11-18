// Publishes GitHub releases from the zips in dist/ (CI step; needs the gh CLI and GH_TOKEN).
//
//   PLAN='<json from ci-plan.mjs>' node scripts/ci-publish.mjs
//
// - One release per bumped plugin: tag <id>-v<version>, asset <id>-<version>.zip, notes from the
//   commits that touched the plugin since its previous release.
// - One rolling release "latest" holding mma-plugins-all.zip with every plugin at its current
//   version. It is deleted and recreated each run so its tag always points at this commit.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const plan = JSON.parse(process.env.PLAN ?? "null");
if (!plan) {
	console.error("PLAN is not set");
	process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY;
const notesDir = mkdtempSync(join(tmpdir(), "notes-"));

function gh(args, opts = {}) {
	return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
}
function git(...args) {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}
function notesFile(name, text) {
	const file = join(notesDir, name);
	writeFileSync(file, text);
	return file;
}

const INSTALL =
	"Unzip into `%APPDATA%\\app.map-making.local\\plugins\\` so that `plugins\\<id>\\manifest.json` exists, then reload MMA.";

for (const p of plan.plugins.filter((p) => p.bumped)) {
	const log = p.previousTag ? git("log", `${p.previousTag}..HEAD`, "--pretty=format:- %s (%h)", "--", `plugins/${p.folder}`) : "";
	let notes = `## ${p.name} ${p.version}\n\n${log || "Initial release."}\n\n${INSTALL}\n`;
	if (p.sidecar) {
		notes += `\nIncludes the GPL-2.0-only native helper \`${p.sidecar.name}\`; its source is at https://github.com/${repo}/tree/${p.tag}/plugins/${p.folder}/sidecar\n`;
	}
	gh([
		"release", "create", p.tag,
		join(dist, `${p.id}-${p.version}.zip`),
		"--target", plan.sha,
		"--title", `${p.name} ${p.version}`,
		"--notes-file", notesFile(`${p.id}.md`, notes),
		"--latest=false",
	]);
	console.log(`[publish] ${p.tag}`);
}

// Rolling bundle.
try {
	gh(["release", "delete", "latest", "--cleanup-tag", "--yes"]);
} catch {
	// No previous bundle release.
}
const table = plan.plugins.map((p) => `| ${p.name} | ${p.version} |`).join("\n");
gh([
	"release", "create", "latest",
	join(dist, "mma-plugins-all.zip"),
	"--target", plan.sha,
	"--title", "All plugins (latest)",
	"--notes-file", notesFile("latest.md", `Every plugin at its current version.\n\n| Plugin | Version |\n| --- | --- |\n${table}\n\n${INSTALL}\n`),
	"--latest",
]);
console.log("[publish] latest (bundle)");
