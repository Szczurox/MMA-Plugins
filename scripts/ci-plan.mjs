// Release planning for CI; also runnable locally to see what a release would do.
//
//   node scripts/ci-plan.mjs
//
// A plugin is "bumped" when no git tag <id>-v<version> exists yet. For plugins with a sidecar it
// also decides whether the compiled exe from the plugin's latest release can be reused: that is
// when nothing under plugins/<id>/sidecar changed since that release's tag.
//
// Prints the plan as JSON. When GITHUB_OUTPUT is set it also writes `plan` (single-line JSON),
// `release` (any plugin bumped) and `build` (any sidecar must be compiled).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = join(root, "plugins");

function git(...args) {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

const plugins = readdirSync(pluginsRoot)
	.filter((name) => statSync(join(pluginsRoot, name)).isDirectory() && existsSync(join(pluginsRoot, name, "manifest.json")))
	.sort()
	.map((folder) => {
		const m = JSON.parse(readFileSync(join(pluginsRoot, folder, "manifest.json"), "utf8"));
		const tag = `${m.id}-v${m.version}`;
		const tags = (git("tag", "--list", `${m.id}-v*`, "--sort=-v:refname") ?? "").split("\n").filter(Boolean);
		const latestTag = tags[0] ?? null;

		let sidecar = null;
		if (m.sidecar) {
			const changed = latestTag ? git("diff", "--name-only", latestTag, "HEAD", "--", `plugins/${folder}/sidecar`) : null;
			sidecar = {
				name: m.sidecar.name,
				// Reuse the exe shipped in the latest release only if the sidecar is untouched since then.
				reuseTag: latestTag && changed === "" ? latestTag : null,
			};
		}
		return {
			id: m.id,
			folder,
			name: m.name,
			version: m.version,
			tag,
			bumped: !tags.includes(tag),
			previousTag: latestTag,
			sidecar,
		};
	});

const plan = {
	sha: git("rev-parse", "HEAD"),
	release: plugins.some((p) => p.bumped),
	build: plugins.some((p) => p.sidecar && !p.sidecar.reuseTag),
	plugins,
};

console.log(JSON.stringify(plan, null, 2));
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`plan=${JSON.stringify(plan)}\nrelease=${plan.release}\nbuild=${plan.build}\n`,
	);
}
