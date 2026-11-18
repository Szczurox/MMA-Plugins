import { test } from "node:test";
import assert from "node:assert/strict";

const failed = [];
let reply = () => [];
globalThis.mma = {
	fail: (id) => failed.push(id),
	log: () => {},
	aborted: () => false,
	progress: () => {},
	sidecar: (_plugin, _command, payload, onLine) => {
		for (const line of reply(JSON.parse(payload))) onLine(line);
	},
};
const { run } = await import(new URL("../build/procedure.js", import.meta.url).href);

test("answered rows are patched, unanswered and invalid rows fail", () => {
	failed.length = 0;
	reply = (rows) => [JSON.stringify({ id: rows[0].id, example: 1 })];
	const out = run([
		{ id: 1, lat: 10, lng: 20 },
		{ id: 2, lat: 11, lng: 21 },
		{ id: 3, lat: NaN, lng: 0 },
	]);
	assert.equal(out.length, 1);
	assert.equal(out[0].id, 1);
	assert.deepEqual(failed.sort(), [2, 3]);
});
