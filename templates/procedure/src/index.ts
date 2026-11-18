// __TITLE__. Targets MMA 0.10.x.

const { registerPlugin, registerProvider, registerEnrichFields } = MMA;

const FIELD = { key: "example", label: "Example" };

registerPlugin({
	activate() {
		registerEnrichFields([FIELD]);
		registerProvider({
			id: "__ID__",
			label: "__TITLE__",
			// MMA 0.10.x field shape: untyped on purpose.
			fieldDefs: {
				[FIELD.key]: { type: "number", label: FIELD.label, values: null, labels: null, comparison: null },
			} as never,
			procedure: { entry: "procedure.js", batch: { mode: "chunk", size: 1000 } },
		});
	},
});
