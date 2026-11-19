// Enrichment: hands a whole chunk of rows to the bundled sidecar, which reads cloud cover
// straight from Open-Meteo's public archive: ECMWF IFS (~9 km) from 2017, ERA5 (0.25 degree) before.
//
// The sidecar prints one JSON object per row: {id, cloudCover}, or {id, error} for a row it could
// not answer, plus {done, ...} at the end and {warn|fatal: text} for problems worth logging.

const PLUGIN_ID = "weatherPlus";
const COMMAND = "lookup";

interface Row {
	id: number;
	lat: number;
	lng: number;
	extra?: Record<string, unknown>;
}

interface Reply {
	id?: number;
	cloudCover?: number;
	error?: string;
	done?: boolean;
	warn?: string;
	fatal?: string;
}

function parseLine(line: string): Reply[] {
	try {
		const parsed = JSON.parse(line);
		const list = Array.isArray(parsed) ? parsed : [parsed];
		return list.filter((p): p is Reply => !!p && typeof p === "object");
	} catch {
		return [];
	}
}

/** Capture time in unix seconds, or null when the row has nothing the sidecar could look up. */
export function captureTime(row: Row): number | null {
	const secs = row.extra?.datetime;
	if (typeof secs !== "number" || !isFinite(secs)) return null;
	if (!isFinite(row.lat) || Math.abs(row.lat) > 90) return null;
	if (!isFinite(row.lng) || Math.abs(row.lng) > 180) return null;
	return secs;
}

export function run(rows: Row[]) {
	if (mma.aborted()) return [];

	const byId = new Map<number, Row>();
	const payload: { id: number; lat: number; lng: number; t: number }[] = [];
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

	const out: unknown[] = [];
	const answered = new Set<number>();
	mma.sidecar(PLUGIN_ID, COMMAND, JSON.stringify(payload), (line: string) => {
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

	// A sidecar that died part-way leaves rows unanswered; they must not look enriched.
	for (const id of byId.keys()) {
		if (!answered.has(id)) {
			mma.fail(id);
			mma.progress(1);
		}
	}
	return out;
}
