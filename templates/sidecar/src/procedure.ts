// Enrichment: hands a chunk of rows to the bundled sidecar, which prints one JSON line per row:
// {id, example} or {id, error}.

const PLUGIN_ID = "__ID__";
const COMMAND = "run";

interface Row {
	id: number;
	lat: number;
	lng: number;
	extra?: Record<string, unknown>;
}

export function run(rows: Row[]) {
	if (mma.aborted()) return [];

	const valid = rows.filter((r) => isFinite(r.lat) && isFinite(r.lng));
	for (const row of rows) if (!valid.includes(row)) mma.fail(row.id);
	if (valid.length === 0) return [];

	const ids = new Set(valid.map((r) => r.id));
	const answered = new Set<number>();
	const out: unknown[] = [];
	const payload = JSON.stringify(valid.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng })));

	mma.sidecar(PLUGIN_ID, COMMAND, payload, (line: string) => {
		let reply: { id?: number; example?: number; error?: string };
		try {
			reply = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof reply.id !== "number" || !ids.has(reply.id) || answered.has(reply.id)) return;
		answered.add(reply.id);
		if (typeof reply.example === "number") {
			out.push({ id: reply.id, patch: { extra: { example: reply.example } } });
		} else {
			mma.fail(reply.id);
		}
		mma.progress(1);
	});

	// A sidecar that died part-way leaves rows unanswered; they must not look enriched.
	for (const id of ids) {
		if (!answered.has(id)) {
			mma.fail(id);
			mma.progress(1);
		}
	}
	return out;
}
