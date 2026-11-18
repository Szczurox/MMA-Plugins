// Creates a plugin under plugins/<name>/ by copying one of the templates in templates/.
//
//   node scripts/new-plugin.mjs <name> [template]
//
// Without a template name, a numbered menu asks which one to use. Each template is a folder with
// a template.json ({ "description": ... }) next to the files to copy. In copied files, text and
// file names, these tokens are replaced:
//   __ID__     plugin id (= folder name), e.g. weatherPlus
//   __TITLE__  display name, e.g. "Weather Plus"
//   __SLUG__   kebab-case id, e.g. weather-plus
//
// <name> is camelCase and starts with a lowercase letter.

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = join(root, "templates");

const fail = (msg) => {
	console.error(msg);
	process.exit(1);
};

const templates = readdirSync(templatesDir, { withFileTypes: true })
	.filter((e) => e.isDirectory() && existsSync(join(templatesDir, e.name, "template.json")))
	.map((e) => ({
		name: e.name,
		description: JSON.parse(readFileSync(join(templatesDir, e.name, "template.json"), "utf8")).description ?? "",
	}))
	.sort((a, b) => a.name.localeCompare(b.name));
if (templates.length === 0) fail("No templates found in templates/");

const [id, templateArg, ...extra] = process.argv.slice(2);
if (!id || id.startsWith("-") || extra.length > 0) {
	fail(`Usage: node scripts/new-plugin.mjs <name> [template]\nTemplates: ${templates.map((t) => t.name).join(", ")}`);
}
if (!/^[a-z][A-Za-z0-9]*$/.test(id)) {
	fail(`Invalid name "${id}": use camelCase letters and digits, starting with a lowercase letter`);
}
const dest = join(root, "plugins", id);
if (existsSync(dest)) fail(`plugins/${id} already exists`);

async function chooseTemplate() {
	console.log("Choose a template:\n");
	templates.forEach((t, i) => console.log(`  ${i + 1}) ${t.name.padEnd(10)} ${t.description}`));
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	// A line queue rather than rl.question(): piped input can end before a question is asked.
	const queue = [];
	let closed = false;
	let waiter = null;
	const wake = (v) => {
		const w = waiter;
		waiter = null;
		w?.(v);
	};
	rl.on("line", (l) => (waiter ? wake(l) : queue.push(l)));
	rl.on("close", () => {
		closed = true;
		wake(null);
	});
	const nextLine = () =>
		queue.length > 0
			? Promise.resolve(queue.shift())
			: closed
				? Promise.resolve(null)
				: new Promise((r) => (waiter = r));
	try {
		for (;;) {
			process.stdout.write("\nTemplate [1]: ");
			const line = await nextLine();
			if (line === null) fail(`\nNo template chosen. Pass one of: ${templates.map((t) => t.name).join(", ")}`);
			const answer = line.trim();
			if (answer === "") return templates[0].name;
			const byIndex = templates[Number(answer) - 1];
			if (byIndex) return byIndex.name;
			if (templates.some((t) => t.name === answer)) return answer;
			console.log(`Enter a number from 1 to ${templates.length}, or a template name.`);
		}
	} finally {
		rl.close();
	}
}

const template = templateArg ?? (await chooseTemplate());
if (!templates.some((t) => t.name === template)) {
	fail(`Unknown template "${template}". Available: ${templates.map((t) => t.name).join(", ")}`);
}

const slug = id.replace(/([A-Z])/g, "-$1").toLowerCase();
const title = id[0].toUpperCase() + id.slice(1).replace(/([A-Z])/g, " $1");
const fill = (text) => text.replaceAll("__ID__", id).replaceAll("__TITLE__", title).replaceAll("__SLUG__", slug);

function copyDir(from, to) {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		if (from === join(templatesDir, template) && entry.name === "template.json") continue;
		const src = join(from, entry.name);
		const out = join(to, fill(entry.name));
		if (entry.isDirectory()) copyDir(src, out);
		else writeFileSync(out, fill(readFileSync(src, "utf8")));
	}
}
copyDir(join(templatesDir, template), dest);
console.log(`\n[new] created plugins/${id} from template "${template}"`);

const r = spawnSync("npm install --no-audit --no-fund", { cwd: dest, stdio: "inherit", shell: true });
if (r.status !== 0) console.warn(`[new] npm install failed; run it in plugins/${id} before building`);
console.log(`Next: just sync ${id}`);
