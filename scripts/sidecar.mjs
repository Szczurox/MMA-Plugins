// Build or test plugin sidecars with the Rust on this machine, normally run through the justfile.
//
//   node scripts/sidecar.mjs build [plugin...]   build the release binary
//   node scripts/sidecar.mjs test  [plugin...]   run its unit tests (no network)
//
// With no plugin names every plugin with a sidecar/Cargo.toml is used. It is `cargo` with the
// settings each platform needs, and it checks the prerequisites first:
//
//   Windows  Rust (https://rustup.rs) with the GNU target (`rustup target add x86_64-pc-windows-gnu`)
//            and MSYS2's MinGW gcc (https://www.msys2.org, then `pacman -S mingw-w64-x86_64-gcc`;
//            C:\msys64\mingw64\bin is found even when it is not on PATH). The GNU target is used
//            because MSVC cannot compile the C code in the sidecars' dependencies.
//   Linux    Rust and a C compiler (`apt install build-essential`).
//   macOS    Rust and Xcode's command line tools (`xcode-select --install`).
//
// A finished build is copied to dist/sidecars/<platform>/<plugin>/<binary>, which is what CI
// uploads, and is also left where the build flow looks for it:
// plugins/<id>/sidecar/target/[<triple>/]release/<binary>

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, binaryName, hostPlatform } from "../scaffold/platforms.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MSYS2_BIN = "C:\\msys64\\mingw64\\bin";

const [mode, ...only] = process.argv.slice(2);
if (!["build", "test"].includes(mode) || only.some((a) => a.startsWith("-"))) {
	console.error("Usage: node scripts/sidecar.mjs <build|test> [plugin...]");
	process.exit(1);
}
const platform = hostPlatform();
if (!platform) {
	console.error(`sidecar: no build for ${process.platform}-${process.arch}; MMA supports windows-x64, linux-x64 and macos-arm64.`);
	process.exit(1);
}
const windows = platform === "windows-x64";
const triple = windows ? PLATFORMS[platform].triples[0] : null;

const ids = readdirSync(join(root, "plugins"))
	.filter((id) => existsSync(join(root, "plugins", id, "sidecar", "Cargo.toml")))
	.filter((id) => only.length === 0 || only.includes(id))
	.sort();
const unknown = only.filter((id) => !ids.includes(id));
if (unknown.length > 0) {
	console.error(`No sidecar found for: ${unknown.join(", ")}`);
	process.exit(1);
}

function fail(message) {
	console.error(`sidecar: ${message}`);
	process.exit(1);
}
const works = (cmd, args, env) => spawnSync(cmd, args, { stdio: "ignore", env }).status === 0;

// --- Prerequisites ----------------------------------------------------------------------------
const env = { ...process.env };
if (!works("cargo", ["--version"], env)) fail("cargo not found. Install Rust from https://rustup.rs.");

if (windows) {
	if (!works("gcc", ["--version"], env) && existsSync(join(MSYS2_BIN, "gcc.exe"))) {
		env.PATH = `${MSYS2_BIN};${env.PATH ?? env.Path ?? ""}`;
		delete env.Path; // Windows env names are case-insensitive; keep a single PATH.
	}
	if (!works("gcc", ["--version"], env)) {
		fail("gcc not found. Install MSYS2 (https://www.msys2.org), run `pacman -S mingw-w64-x86_64-gcc` in it, and add C:\\msys64\\mingw64\\bin to PATH.");
	}
	const installed = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8", env });
	if (!(installed.stdout ?? "").split(/\r?\n/).includes(triple)) fail(`the Rust target ${triple} is missing. Run: rustup target add ${triple}`);
	env.CC ??= "gcc"; // the C build would otherwise prefer clang when one is installed
} else if (!works("cc", ["--version"], env)) {
	fail(process.platform === "darwin" ? "no C compiler. Run: xcode-select --install" : "no C compiler. Install one, e.g. `apt install build-essential`.");
}

// --- Build ------------------------------------------------------------------------------------
for (const id of ids) {
	console.log(`\n== ${id} (${mode}, ${platform})`);
	const dir = join(root, "plugins", id, "sidecar");
	const name = JSON.parse(readFileSync(join(root, "plugins", id, "manifest.json"), "utf8")).sidecar?.name;
	if (mode === "build" && !name) fail(`plugins/${id}/manifest.json has no sidecar.name`);

	const args = [mode === "build" ? "build" : "test", "--release", ...(triple ? ["--target", triple] : [])];
	const r = spawnSync("cargo", args, { cwd: dir, stdio: "inherit", env });
	if (r.status !== 0) fail(`cargo ${args[0]} failed`);
	if (mode !== "build") continue;

	const bin = binaryName(name, platform);
	const built = join(dir, "target", ...(triple ? [triple] : []), "release", bin);
	if (!existsSync(built)) fail(`expected ${built} after the build`);
	const staged = join(root, "dist", "sidecars", platform, id);
	mkdirSync(staged, { recursive: true });
	copyFileSync(built, join(staged, bin));
	console.log(`built ${built}\nstaged ${join(staged, bin)}`);
}
