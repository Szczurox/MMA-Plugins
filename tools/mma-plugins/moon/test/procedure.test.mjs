import { test } from "node:test";
import assert from "node:assert/strict";

const failed = [];
globalThis.mma = { fail: (id) => failed.push(id), log: () => {} };
const { map, configure } = await import(new URL("../procedure.js", import.meta.url).href);
const t = (s) => Date.parse(s) / 1000;
const run = (extra, lat = -23.7, lng = 133.88) => {
	configure({ fields: [], force: false, config: null });
	return map([{ id: 1, lat, lng, extra }])[0]?.patch.extra;
};

test("first-quarter afternoon moon over Alice Springs is visible, E, ~60° up", () => {
	const p = run({ datetime: t("2024-10-10T06:30:00Z"), cloudCover: 10 });
	assert.equal(p.moonVisibility, "yes");
	assert.equal(p.moonDirection, "E");
	assert.ok(Math.abs(p.moonAltitude - 60.6) < 2); // astropy reference
});

test("heavy cloud hides it", () => {
	assert.equal(run({ datetime: t("2024-10-10T06:30:00Z"), cloudCover: 90 }).moonVisibility, "no");
});

test("new moon is never visible", () => {
	assert.equal(run({ datetime: t("2024-10-02T02:00:00Z"), cloudCover: 10 }, -42.88, 147.33).moonVisibility, "no");
});

test("missing datetime fails the row", () => {
	assert.equal(run({}), undefined);
});

test("each provider group writes only its own fields", () => {
	const rowIn = [{ id: 1, lat: -23.7, lng: 133.88, extra: { datetime: t("2024-10-10T06:30:00Z"), cloudCover: 10 } }];
	configure({ fields: [], force: false, config: { group: "position" } });
	const pos = Object.keys(map(rowIn)[0].patch.extra).sort();
	assert.deepEqual(pos, ["moonAltitude", "moonAzimuth", "moonDirection", "moonIllumination", "moonPhase"]);
	configure({ fields: [], force: false, config: { group: "visibility" } });
	assert.deepEqual(Object.keys(map(rowIn)[0].patch.extra), ["moonVisibility"]);
});

test("visibility without cloud cover is not guessed: the row fails, position rows still work", () => {
	const rowIn = [{ id: 7, lat: -23.7, lng: 133.88, extra: { datetime: t("2024-10-10T06:30:00Z") } }];
	failed.length = 0;
	configure({ fields: [], force: false, config: { group: "visibility" } });
	assert.deepEqual(map(rowIn), []);
	assert.deepEqual(failed, [7]);
	configure({ fields: [], force: false, config: { group: "position" } });
	assert.ok(map(rowIn)[0].patch.extra.moonAzimuth !== undefined);
});
