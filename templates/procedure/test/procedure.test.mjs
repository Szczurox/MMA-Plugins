import { test } from "node:test";
import assert from "node:assert/strict";

const failed = [];
globalThis.mma = { fail: (id) => failed.push(id), log: () => {} };
const { map } = await import(new URL("../build/procedure.js", import.meta.url).href);

test("rows with valid coordinates are patched, others fail", () => {
	failed.length = 0;
	const out = map([
		{ id: 1, lat: 10, lng: 20 },
		{ id: 2, lat: NaN, lng: 20 },
	]);
	assert.equal(out.length, 1);
	assert.equal(out[0].id, 1);
	assert.deepEqual(failed, [2]);
});
