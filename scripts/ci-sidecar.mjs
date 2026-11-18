// Puts each sidecar exe where the plugin build looks for it (CI step).
//
//   PLAN='<json from ci-plan.mjs>' node scripts/ci-sidecar.mjs
//
// A plugin whose sidecar is unchanged since its latest release gets the exe back from that
// release's zip (needs the gh CLI and GH_TOKEN). Otherwise the sidecar is compiled with its own
// setup.mjs and `cargo build --release`. A failed download falls back to compiling.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipMember } from "./package.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plan = JSON.parse(process.env.PLAN ?? "null");
if (!plan) {
	console.error("PLAN is not set");
	process.exit(1);
}

function run(cmd, args, cwd) {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function reuse(p, exeDir) {
	const tmp = mkdtempSync(join(tmpdir(), `${p.id}-`));
	run("gh", ["release", "download", p.sidecar.reuseTag, "--pattern", "*.zip", "--dir", tmp], root);
	const zipFile = readdirSync(tmp).find((f) => f.endsWith(".zip"));
	if (!zipFile) throw new Error("release has no zip asset");
	const exe = `${p.sidecar.name}.exe`;
	unzipMember(join(tmp, zipFile), join(tmp, "x"), `${p.id}/sidecar/${exe}`);
	mkdirSync(exeDir, { recursive: true });
	copyFileSync(join(tmp, "x", p.id, "sidecar", exe), join(exeDir, exe));
}

for (const p of plan.plugins.filter((p) => p.sidecar)) {
	const sidecarDir = join(root, "plugins", p.folder, "sidecar");
	const exeDir = join(sidecarDir, "target", "x86_64-pc-windows-gnu", "release");
	console.log(`\n== ${p.id} sidecar`);

	if (p.sidecar.reuseTag) {
		try {
			reuse(p, exeDir);
			console.log(`[sidecar] reused ${p.sidecar.name}.exe from ${p.sidecar.reuseTag}`);
			continue;
		} catch (e) {
			console.warn(`[sidecar] could not reuse (${e.message}); compiling instead`);
		}
	}
	run("node", ["setup.mjs"], sidecarDir);
	run("cargo", ["build", "--release"], sidecarDir);
	if (!existsSync(join(exeDir, `${p.sidecar.name}.exe`))) throw new Error(`${p.sidecar.name}.exe was not produced`);
	console.log(`[sidecar] compiled ${p.sidecar.name}.exe`);
}
