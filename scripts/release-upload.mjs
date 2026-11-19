// Creates the GitHub releases from the archives in dist/. Runs in the Release workflow's last job;
// it refuses to run anywhere else, because a release must contain every platform's build.
//
//   node scripts/release-upload.mjs
//
// For each plugin whose version has no tag yet: a release <id>-v<version> with the plugin's
// archive(s) (one per system when it has a sidecar), notes from its CHANGES.md entry plus the
// install steps. Then the rolling "bundle" release is recreated with the per-platform all-plugins
// archives. Needs GH_TOKEN.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORMS, PLATFORM_TAGS, bundleArchive, pluginArchive } from "../scaffold/platforms.mjs";
import { git, originRepo, planReleases, printPlan, root } from "./release-plan.mjs";

if (process.env.GITHUB_ACTIONS !== "true") {
	console.error("Releases are made by the Release workflow. Run `just release` to start it.");
	process.exit(1);
}

const dist = join(root, "dist");
const gh = (a) => execFileSync("gh", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const { plugins, bumped, problems } = planReleases({ ci: true });
printPlan(plugins);
if (problems.length > 0) {
	console.error(`\n${problems.map((m) => `  - ${m}`).join("\n")}`);
	process.exit(1);
}

const INSTALL = [
	"Extract into MMA's plugins folder so that `plugins/<id>/manifest.json` exists, then reload MMA:",
	"",
	"- Windows: `%APPDATA%\\app.map-making.local\\plugins`",
	"- macOS: `~/Library/Application Support/app.map-making.local/plugins`",
	"- Linux: `~/.local/share/app.map-making.local/plugins`",
].join("\n");
const SYSTEMS = `one archive per system (${PLATFORM_TAGS.map((t) => `\`${t}\` as \`.${PLATFORMS[t].archive}\``).join(", ")}); take the one for your computer.`;
const PLATFORM_NOTE = `Plugins with a native helper come as ${SYSTEMS}`;

const sha = git("rev-parse", "HEAD");
const repo = originRepo();
const tmp = mkdtempSync(join(tmpdir(), "release-"));
const write = (name, text) => {
	const file = join(tmp, name);
	writeFileSync(file, text);
	return file;
};

/** The archives of a plugin version: one per platform when it has a sidecar, else one zip. */
function archivesOf(p) {
	const names = p.sidecar ? PLATFORM_TAGS.map((t) => pluginArchive(p.id, p.version, t, true)) : [pluginArchive(p.id, p.version, null, false)];
	const missing = names.filter((n) => !existsSync(join(dist, n)));
	if (missing.length > 0) {
		console.error(`${p.id}: missing ${missing.join(", ")} in dist/`);
		process.exit(1);
	}
	return names.map((n) => join(dist, n));
}

for (const p of bumped) {
	const zips = archivesOf(p);
	let notes = `## ${p.name} ${p.version}\n\n${p.notes}\n\n${INSTALL}\n`;
	if (p.sidecar) {
		notes += `\n${PLATFORM_NOTE}\n`;
		if (repo) notes += `\nIncludes the GPL-2.0-only native helper \`${p.sidecar.name}\`; its source is at https://github.com/${repo}/tree/${p.tag}/plugins/${p.folder}/sidecar\n`;
	}
	gh(["release", "create", p.tag, ...zips, "--target", sha, "--title", `${p.name} ${p.version}`, "--notes-file", write(`${p.id}.md`, notes), "--latest=false"]);
	console.log(`[publish] ${p.tag}`);
}

if (bumped.length > 0) {
	try {
		gh(["release", "delete", "bundle", "--cleanup-tag", "--yes"]);
	} catch {
		// No earlier bundle release.
	}
	const bundles = PLATFORM_TAGS.map((t) => join(dist, bundleArchive(t)));
	for (const b of bundles) if (!existsSync(b)) throw new Error(`missing ${b}`);
	const table = plugins.map((p) => `| ${p.name} | ${p.version} |`).join("\n");
	const note = `Every plugin at its current version, ${SYSTEMS}\n\n| Plugin | Version |\n| --- | --- |\n${table}\n\n${INSTALL}\n`;
	gh(["release", "create", "bundle", ...bundles, "--target", sha, "--title", "Bundle (all plugins)", "--notes-file", write("bundle.md", note), "--latest"]);
	console.log("[publish] bundle");
}
if (repo) console.log(`\nDone: https://github.com/${repo}/releases`);
