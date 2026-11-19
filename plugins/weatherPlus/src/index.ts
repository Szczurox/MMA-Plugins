// Weather+: historical cloud cover at the exact capture time, from ECMWF IFS (2017+) and ERA5. Targets MMA 0.10.x.
//
// Data enrichment only: no sidebar. The work happens in procedure.ts, which hands rows to the
// bundled sidecar. The field key matches the upstream Weather plugin, so Moon's cloud-aware verdict
// reads either; disable the upstream Weather plugin while this one is on, since two providers
// cannot own the same field.

const { registerPlugin, registerProvider, registerEnrichFields } = MMA;

const FIELD = { key: "cloudCover", label: "Cloud cover (%)" };

registerPlugin({
	activate() {
		registerEnrichFields([{ ...FIELD, defaultOff: true }]);
		registerProvider({
			id: "weatherPlus",
			label: "Weather+",
			// MMA 0.10.x field shape (see Moon): untyped on purpose.
			fieldDefs: {
				[FIELD.key]: { type: "number", label: FIELD.label, values: null, labels: null, comparison: null },
			} as never,
			requires: ["datetime"],
			procedure: {
				entry: "procedure.js",
				// One helper run per chunk: it opens the archive files its rows need, so big chunks
				// amortise that, while a chunk stays short enough to cancel promptly.
				batch: { mode: "chunk", size: 5000 },
				instances: 1,
			},
		});
	},
});
