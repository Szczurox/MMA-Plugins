// weatherPlus/src/index.ts
var { registerPlugin, registerProvider, registerEnrichFields } = MMA;
var FIELD = { key: "cloudCover", label: "Cloud cover (%)" };
registerPlugin({
  activate() {
    registerEnrichFields([{ ...FIELD, defaultOff: true }]);
    registerProvider({
      id: "weatherPlus",
      label: "Weather+",
      // MMA 0.10.x field shape (see Moon): untyped on purpose.
      fieldDefs: {
        [FIELD.key]: { type: "number", label: FIELD.label, values: null, labels: null, comparison: null }
      },
      requires: ["datetime"],
      procedure: {
        entry: "procedure.js",
        // One helper run per chunk: it opens the archive files its rows need, so big chunks
        // amortise that, while a chunk stays short enough to cancel promptly.
        batch: { mode: "chunk", size: 5e3 },
        instances: 1
      }
    });
  }
});
