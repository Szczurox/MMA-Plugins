// Starts the Release workflow on GitHub by hand from this machine. The workflow does the work: it
// builds every plugin's sidecar on Windows, Linux and macOS runners, packages one archive per platform
// and creates the GitHub releases (see .github/workflows/release.yml).
//
//   node scripts/publish.mjs [--dry-run] [--build-only] [--yes]
//
// The workflow already starts by itself when a push to main changes a plugin's manifest.json, so
// bumping `version` (plus a `## <version>` entry in CHANGES.md) and pushing is a release. Use this
// to retry a failed run or to try the builds with --build-only. A plugin is released when no git tag
// <id>-v<version> exists yet. It checks that the local state matches what the workflow will build
// from (on main, clean tree, everything pushed, a CHANGES.md entry for every new version, gh logged
// in), shows the plan, asks for confirmation and starts the workflow.
//
//   --dry-run     only run the checks and show the plan; nothing is started
//   --build-only  start the workflow in its dry-run mode: it builds, tests and packages on every
//                 platform but publishes nothing (a way to try the macOS and Linux builds)
//   --yes         skip the confirmation prompt
//
// Needs the GitHub CLI (https://cli.github.com), logged in with `gh auth login`, and the workflow
// file pushed to main.

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { originRepo, planReleases, printPlan } from "./release-plan.mjs";

const args = process.argv.slice(2);
const bad = args.filter((a) => !["--dry-run", "--build-only", "--yes"].includes(a));
if (bad.length > 0) {
	console.error(`Unknown argument(s): ${bad.join(", ")}\nUsage: node scripts/publish.mjs [--dry-run] [--build-only] [--yes]`);
	process.exit(1);
}
const dryRun = args.includes("--dry-run");
const buildOnly = args.includes("--build-only");
const yes = args.includes("--yes");

const { plugins, bumped, problems } = planReleases({ ci: false });
printPlan(plugins);

if (problems.length > 0) {
	console.error(`\n${problems.length} problem(s):\n${problems.map((m) => `  - ${m}`).join("\n")}`);
	process.exit(1);
}
if (bumped.length === 0 && !buildOnly) {
	console.log("\nNothing to release: every plugin's version already has a tag.");
	process.exit(0);
}
if (dryRun) {
	console.log("\nDry run: all checks passed, nothing was started.");
	process.exit(0);
}

if (!yes) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const what = buildOnly
		? "Start the Release workflow in build-only mode (nothing is published)?"
		: `Start the Release workflow to publish ${bumped.length} release(s) plus the "bundle" release?`;
	const answer = (await rl.question(`\n${what} [y/N] `)).trim().toLowerCase();
	rl.close();
	if (answer !== "y" && answer !== "yes") {
		console.log("Cancelled.");
		process.exit(0);
	}
}

const run = ["workflow", "run", "release.yml", "--ref", "main", ...(buildOnly ? ["-f", "dry_run=true"] : [])];
try {
	execFileSync("gh", run, { stdio: "inherit" });
} catch {
	console.error("\nCould not start the workflow. Is .github/workflows/release.yml pushed to main?");
	process.exit(1);
}
const repo = originRepo();
console.log(`\nStarted. Follow it with \`gh run watch\`${repo ? ` or at https://github.com/${repo}/actions/workflows/release.yml` : ""}.`);
