// weatherPlus/src/procedure.ts
var PLUGIN_ID = "weatherPlus";
var COMMAND = "lookup";
function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((p) => !!p && typeof p === "object");
  } catch {
    return [];
  }
}
function captureTime(row) {
  const secs = row.extra?.datetime;
  if (typeof secs !== "number" || !isFinite(secs)) return null;
  if (!isFinite(row.lat) || Math.abs(row.lat) > 90) return null;
  if (!isFinite(row.lng) || Math.abs(row.lng) > 180) return null;
  return secs;
}
function run(rows) {
  if (mma.aborted()) return [];
  const byId = /* @__PURE__ */ new Map();
  const payload = [];
  for (const row of rows) {
    const t = captureTime(row);
    if (t === null) {
      mma.fail(row.id);
      mma.progress(1);
      continue;
    }
    byId.set(row.id, row);
    payload.push({ id: row.id, lat: row.lat, lng: row.lng, t });
  }
  if (payload.length === 0) return [];
  const out = [];
  const answered = /* @__PURE__ */ new Set();
  mma.sidecar(PLUGIN_ID, COMMAND, JSON.stringify(payload), (line) => {
    for (const reply of parseLine(line)) {
      if (reply.fatal) mma.log(3, `weatherPlus bulk: ${reply.fatal}`);
      if (reply.warn) mma.log(2, `weatherPlus bulk: ${reply.warn}`);
      if (typeof reply.id !== "number" || !byId.has(reply.id) || answered.has(reply.id)) continue;
      answered.add(reply.id);
      if (typeof reply.cloudCover === "number") {
        out.push({ id: reply.id, patch: { extra: { cloudCover: reply.cloudCover } } });
      } else {
        mma.fail(reply.id);
      }
      mma.progress(1);
    }
  });
  for (const id of byId.keys()) {
    if (!answered.has(id)) {
      mma.fail(id);
      mma.progress(1);
    }
  }
  return out;
}
export {
  captureTime,
  run
};
