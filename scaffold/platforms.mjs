// The platforms MMA runs sidecars on, named the way MMA names them (windows-x64, macos-arm64,
// linux-x64). A plugin with a sidecar ships one zip per platform; the others ship a single zip.

export const PLATFORMS = {
	"windows-x64": { os: "win32", arch: "x64", exe: ".exe", triples: ["x86_64-pc-windows-gnu"], label: "Windows" },
	"linux-x64": { os: "linux", arch: "x64", exe: "", triples: ["x86_64-unknown-linux-gnu"], label: "Linux" },
	"macos-arm64": { os: "darwin", arch: "arm64", exe: "", triples: ["aarch64-apple-darwin"], label: "macOS (Apple silicon)" },
};

export const PLATFORM_TAGS = Object.keys(PLATFORMS);

/** The platform this machine is, or null when MMA has no sidecar build for it. */
export function hostPlatform() {
	return PLATFORM_TAGS.find((t) => PLATFORMS[t].os === process.platform && PLATFORMS[t].arch === process.arch) ?? null;
}

/** The platform being built for: MMA_PLATFORM when set (CI packages every platform), else this machine. */
export function targetPlatform() {
	const tag = process.env.MMA_PLATFORM;
	if (tag && !PLATFORMS[tag]) throw new Error(`Unknown platform "${tag}"; expected ${PLATFORM_TAGS.join(", ")}`);
	return tag || hostPlatform();
}

/** File name of a sidecar binary on a platform: `<name>.exe` on Windows, `<name>` elsewhere. */
export function binaryName(name, platform) {
	return name + PLATFORMS[platform].exe;
}
