const { registerPlugin, registerProvider, registerEnrichFields } = MMA;

// MMA 0.10.x field shape: `values` is the plain value list (what the filter dropdown offers),
// `labels` maps each stored value to its display text. The bundled types describe a newer
// {value,label}[] shape, so these defs are deliberately untyped.
const enumField = (label: string, pairs: [string, string][]) => ({
	type: "enum",
	label,
	values: pairs.map(([v]) => v),
	labels: pairs,
	comparison: null,
});

const numberField = (label: string, comparison: unknown = null) => ({
	type: "number",
	label,
	values: null,
	labels: null,
	comparison,
});

const FIELDS = {
	moonVisibility: enumField("Moon visibility", [
		["yes", "Visible"],
		["low", "Marginal"],
		["no", "Not visible"],
	]),
	moonPhase: enumField("Moon phase", [
		["new", "New moon"],
		["waxingCrescent", "Waxing crescent"],
		["firstQuarter", "First quarter"],
		["waxingGibbous", "Waxing gibbous"],
		["full", "Full moon"],
		["waningGibbous", "Waning gibbous"],
		["lastQuarter", "Last quarter"],
		["waningCrescent", "Waning crescent"],
	]),
	moonIllumination: numberField("Moon illumination (%)"),
	moonDirection: enumField(
		"Moon direction",
		["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map(
			(d) => [d, d] as [string, string],
		),
	),
	moonAzimuth: numberField("Moon azimuth", { type: "circular", period: 360 }),
	moonAltitude: numberField("Moon altitude"),
};

const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, FIELDS[k as keyof typeof FIELDS]]));

// Two providers over one procedure, so a field can depend on weather without the rest doing so.
// `requires` is per provider in MMA, hence the split.
const PROVIDERS = [
	{
		id: "moon",
		label: "Moon position",
		group: "position",
		keys: ["moonPhase", "moonIllumination", "moonDirection", "moonAzimuth", "moonAltitude"],
		requires: ["datetime"],
	},
	{
		id: "moonVisibility",
		label: "Moon visibility",
		group: "visibility",
		keys: ["moonVisibility"],
		// Visibility accounts for cloud cover, so it waits for Weather and skips locations without it.
		requires: ["datetime", "cloudCover"],
	},
];

registerPlugin({
	activate() {
		// MMA 0.10.x lists a provider's fields in the Enrichment tab only when they are
		// registered here (newer apps derive this from fieldDefs; the call is deprecated there).
		registerEnrichFields(
			Object.entries(FIELDS).map(([key, def]) => ({
				key,
				label: def.label,
			})),
		);
		for (const p of PROVIDERS) {
			registerProvider({
				id: p.id,
				label: p.label,
				fieldDefs: pick(p.keys) as never,
				requires: p.requires,
				procedure: {
					entry: "procedure.js",
					config: JSON.stringify({ group: p.group }),
					batch: { mode: "chunk", size: 10000 },
				},
			});
		}
	},
});
