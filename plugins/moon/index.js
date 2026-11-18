// moon/src/index.ts
var { registerPlugin, registerProvider, registerEnrichFields } = MMA;
var enumField = (label, pairs) => ({
  type: "enum",
  label,
  values: pairs.map(([v]) => v),
  labels: pairs,
  comparison: null
});
var numberField = (label, comparison = null) => ({
  type: "number",
  label,
  values: null,
  labels: null,
  comparison
});
var FIELDS = {
  moonVisibility: enumField("Moon visibility", [
    ["yes", "Visible"],
    ["low", "Marginal"],
    ["no", "Not visible"]
  ]),
  moonPhase: enumField("Moon phase", [
    ["new", "New moon"],
    ["waxingCrescent", "Waxing crescent"],
    ["firstQuarter", "First quarter"],
    ["waxingGibbous", "Waxing gibbous"],
    ["full", "Full moon"],
    ["waningGibbous", "Waning gibbous"],
    ["lastQuarter", "Last quarter"],
    ["waningCrescent", "Waning crescent"]
  ]),
  moonIllumination: numberField("Moon illumination (%)"),
  moonDirection: enumField(
    "Moon direction",
    ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map(
      (d) => [d, d]
    )
  ),
  moonAzimuth: numberField("Moon azimuth", { type: "circular", period: 360 }),
  moonAltitude: numberField("Moon altitude")
};
var pick = (keys) => Object.fromEntries(keys.map((k) => [k, FIELDS[k]]));
var PROVIDERS = [
  {
    id: "moon",
    label: "Moon position",
    group: "position",
    keys: ["moonPhase", "moonIllumination", "moonDirection", "moonAzimuth", "moonAltitude"],
    requires: ["datetime"]
  },
  {
    id: "moonVisibility",
    label: "Moon visibility",
    group: "visibility",
    keys: ["moonVisibility"],
    // Visibility accounts for cloud cover, so it waits for Weather and skips locations without it.
    requires: ["datetime", "cloudCover"]
  }
];
registerPlugin({
  activate() {
    registerEnrichFields(
      Object.entries(FIELDS).map(([key, def]) => ({
        key,
        label: def.label
      }))
    );
    for (const p of PROVIDERS) {
      registerProvider({
        id: p.id,
        label: p.label,
        fieldDefs: pick(p.keys),
        requires: p.requires,
        procedure: {
          entry: "procedure.js",
          config: JSON.stringify({ group: p.group }),
          batch: { mode: "chunk", size: 1e4 }
        }
      });
    }
  }
});
