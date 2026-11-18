// Enrichment: runs in MMA's QuickJS guest (no DOM, no Node APIs).

interface Row {
	id: number;
	lat: number;
	lng: number;
	extra?: Record<string, unknown>;
}

export function configure(_cfg: unknown) {}

export function map(rows: Row[]) {
	const out: unknown[] = [];
	for (const row of rows) {
		if (!isFinite(row.lat) || !isFinite(row.lng)) {
			mma.fail(row.id);
			continue;
		}
		// TODO: compute the real value.
		out.push({ id: row.id, patch: { extra: { example: 0 } } });
	}
	return out;
}
