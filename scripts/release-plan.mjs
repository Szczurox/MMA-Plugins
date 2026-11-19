// Works out which plugins need a release: those whose manifest version has no git tag
// <id>-v<version> yet. Shared by `just release` (local checks) and the Release workflow.
//
//   node scripts/release-plan.mjs [--ci] [--github-output]
//
// Checks that every new version has a `## <version>` entry in CHANGES.md. Without --ci it also
// checks the local state the workflow will build from: on main, clean tree, everything pushed, and
// the GitHub CLI logged in. --github-output writes `any=true|false` to $GITHUB_OUTPUT.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = join(root, "plugins");

export function git(...a) {
	return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
export function gitTry(...a) {
	try {
		return git(...a);
	} catch {
		return null;
	}
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

/** `owner/name` of the origin remote, or undefined. */
export function originRepo() {
	return (gitTry("remote", "get-url", "origin")?.match(/github\.com[:/](.+?)(?:\.git)?$/) ?? [])[1];
}

/** Every plugin with whether its version is new, plus the problems that block a release. */
export function planReleases({ ci = false } = {}) {
	const problems = [];
	const problem = (m) => problems.push(m);

	gitTry("fetch", "--tags", "--quiet");
	if (!ci) {
		const branch = gitTry("branch", "--show-current");
		if (branch !== "main") problem(`on branch "${branch}"; releases are made from main`);
		if (git("status", "--porcelain")) problem("the working tree has uncommitted or untracked changes");
		const ahead = gitTry("rev-list", "--count", "@{u}..HEAD");
		if (ahead === null) problem("the branch has no upstream; push it first");
		else if (ahead !== "0") problem(`${ahead} commit(s) are not pushed yet`);
		if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
			problem("the GitHub CLI is not installed or not logged in (https://cli.github.com, then `gh auth login`)");
		}
	}

	const plugins = readdirSync(pluginsRoot)
		.filter((n) => statSync(join(pluginsRoot, n)).isDirectory() && existsSync(join(pluginsRoot, n, "manifest.json")))
		.sort()
		.map((folder) => {
			const dir = join(pluginsRoot, folder);
			const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
			const tag = `${m.id}-v${m.version}`;
			const tags = (gitTry("tag", "--list", `${m.id}-v*`, "--sort=-v:refname") ?? "").split("\n").filter(Boolean);
			const p = { id: m.id, folder, name: m.name, version: m.version, tag, bumped: !tags.includes(tag), notes: null, sidecar: m.sidecar ?? null };
			if (p.bumped) {
				const file = join(dir, "CHANGES.md");
				if (!existsSync(file)) problem(`${m.id}: plugins/${folder}/CHANGES.md is missing`);
				else {
					p.notes = changesFor(readFileSync(file, "utf8"), m.version);
					if (!p.notes) problem(`${m.id}: CHANGES.md has no "## ${m.version}" entry with content`);
				}
			}
			return p;
		});

	return { plugins, bumped: plugins.filter((p) => p.bumped), problems };
}

export function printPlan(plugins) {
	console.log("Plugins:");
	for (const p of plugins) console.log(`  ${p.bumped ? "RELEASE" : "up to date"}  ${p.id} ${p.version}${p.bumped ? `  -> ${p.tag}` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	const bad = args.filter((a) => !["--ci", "--github-output"].includes(a));
	if (bad.length > 0) {
		console.error(`Unknown argument(s): ${bad.join(", ")}\nUsage: node scripts/release-plan.mjs [--ci] [--github-output]`);
		process.exit(1);
	}
	const { plugins, bumped, problems } = planReleases({ ci: args.includes("--ci") });
	printPlan(plugins);
	if (args.includes("--github-output") && process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `any=${bumped.length > 0}\n`);
	}
	if (problems.length > 0) {
		console.error(`\n${problems.length} problem(s):\n${problems.map((m) => `  - ${m}`).join("\n")}`);
		process.exit(1);
	}
	if (bumped.length === 0) console.log("\nNothing to release: every plugin's version already has a tag.");
}
