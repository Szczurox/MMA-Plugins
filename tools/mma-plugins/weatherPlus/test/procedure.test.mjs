import { test } from "node:test";
import assert from "node:assert/strict";

const failed = [];
let progress = 0;
let sidecarCall = null;
let reply = () => [];
globalThis.mma = {
	fail: (id) => failed.push(id),
	log: () => {},
	aborted: () => false,
	progress: (n) => (progress += n),
	sidecar: (plugin, command, payload, onLine) => {
		sidecarCall = { plugin, command, payload: JSON.parse(payload) };
		for (const line of reply(sidecarCall.payload)) onLine(line);
	},
};
const { run, captureTime } = await import(new URL("../procedure.js", import.meta.url).href);

const row = (id, lat, lng, secs) => ({ id, lat, lng, extra: secs === undefined ? {} : { datetime: secs } });
const reset = () => {
	failed.length = 0;
	progress = 0;
	sidecarCall = null;
};

test("sends only rows with a time and valid coordinates, fails the rest", () => {
	reset();
	reply = (payload) => payload.map((p) => JSON.stringify({ id: p.id, cloudCover: 40 }));
	const out = run([row(1, -33.9, 151.2, 1732655890), row(2, -33.9, 151.2), row(3, 95, 0, 1732655890)]);
	assert.equal(sidecarCall.plugin, "weatherPlus");
	assert.equal(sidecarCall.command, "lookup");
	assert.deepEqual(sidecarCall.payload, [{ id: 1, lat: -33.9, lng: 151.2, t: 1732655890 }]);
	assert.deepEqual(out, [{ id: 1, patch: { extra: { cloudCover: 40 } } }]);
	assert.deepEqual(failed, [2, 3]);
	assert.equal(progress, 3);
});

test("per-row errors fail only that row; zero cloud cover is a real value", () => {
	reset();
	reply = () => [
		JSON.stringify({ id: 1, cloudCover: 0 }),
		JSON.stringify({ id: 2, error: "no data" }),
		JSON.stringify({ done: true, rows: 2 }),
	];
	const out = run([row(1, 0, 0, 1e9), row(2, 0, 0, 1e9)]);
	assert.deepEqual(out, [{ id: 1, patch: { extra: { cloudCover: 0 } } }]);
	assert.deepEqual(failed, [2]);
});

test("rows a dying sidecar never answered are failed, not left blank", () => {
	reset();
	reply = () => [JSON.stringify({ id: 1, cloudCover: 55 })];
	const out = run([row(1, 0, 0, 1e9), row(2, 0, 0, 1e9)]);
	assert.equal(out.length, 1);
	assert.deepEqual(failed, [2]);
	assert.equal(progress, 2);
});

test("accepts arrays of replies on one line and ignores junk and unknown ids", () => {
	reset();
	reply = () => [
		"not json",
		JSON.stringify([
			{ id: 1, cloudCover: 10 },
			{ id: 99, cloudCover: 20 },
		]),
	];
	const out = run([row(1, 0, 0, 1e9)]);
	assert.deepEqual(out, [{ id: 1, patch: { extra: { cloudCover: 10 } } }]);
	assert.deepEqual(failed, []);
});

test("captureTime rejects non-numbers and bad coordinates", () => {
	assert.equal(captureTime(row(1, 0, 0, 5)), 5);
	assert.equal(captureTime(row(1, 0, 0, NaN)), null);
	assert.equal(captureTime(row(1, 0, 181, 5)), null);
	assert.equal(captureTime({ id: 1, lat: 0, lng: 0 }), null);
});
