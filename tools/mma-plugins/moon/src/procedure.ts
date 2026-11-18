// Moon position + daytime visibility, map shape: pure compute over lat/lng and
// `extra.datetime`. Visibility also needs `extra.cloudCover` (Weather or Weather+); a row without
// it gets no visibility, and is failed when that was the only thing asked for.

import SunCalc from "suncalc";
import type { Location, Patch, ProcedureConfig } from "mma-plugin-types";

const DEG = 180 / Math.PI;
const MAX_TIME_MS = 8.64e15;

export interface MoonConfig {
	/** Moon altitude (deg) at or above which it counts as clearly up. */
	altYes: number;
	/** Moon altitude (deg) below which it is lost to haze / vegetation. */
	altLow: number;
	/** Illuminated fraction (0-1) at or above which a daytime moon is easy to spot. */
	illumYes: number;
	/** Illuminated fraction below which a daytime moon is invisible. */
	illumLow: number;
	/** Sun-moon angular separation (deg) below which the moon is lost in glare. */
	minElongation: number;
	/** Cloud cover (%) at or above which the verdict drops from yes to low. */
	cloudLow: number;
	/** Cloud cover (%) at or above which the moon is hidden. */
	cloudNo: number;
}

export const DEFAULTS: MoonConfig = {
	altYes: 15,
	altLow: 5,
	illumYes: 0.25,
	illumLow: 0.08,
	minElongation: 25,
	cloudLow: 50,
	cloudNo: 85,
};

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** suncalc phase 0..1: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
const PHASES = [
	"new",
	"waxingCrescent",
	"firstQuarter",
	"waxingGibbous",
	"full",
	"waningGibbous",
	"lastQuarter",
	"waningCrescent",
] as const;

const round1 = (v: number) => Math.round(v * 10) / 10;
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** suncalc azimuth is from south, radians; the app's convention is north-clockwise degrees. */
const azNorth = (rad: number) => norm360(rad * DEG + 180);

export function direction(az: number): string {
	return DIRECTIONS[Math.round(norm360(az) / 45) % 8];
}

export function phaseName(phase: number): string {
	return PHASES[Math.round(phase * 8) % 8];
}

/** Great-circle angle between two alt/az directions, degrees. */
export function separation(
	alt1: number,
	az1: number,
	alt2: number,
	az2: number,
): number {
	const r = 1 / DEG;
	const c =
		Math.sin(alt1 * r) * Math.sin(alt2 * r) +
		Math.cos(alt1 * r) * Math.cos(alt2 * r) * Math.cos((az1 - az2) * r);
	return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}

export interface Inputs {
	moonAlt: number;
	illum: number;
	elongation: number;
	cloud: number;
}

/** "yes" | "low" | "no". Hard stops first, then any soft condition demotes to "low". */
export function visibility(i: Inputs, c: MoonConfig): "yes" | "low" | "no" {
	if (i.moonAlt < c.altLow) return "no";
	if (i.illum < c.illumLow) return "no";
	if (i.elongation < c.minElongation) return "no";
	if (i.cloud >= c.cloudNo) return "no";
	const soft =
		i.moonAlt < c.altYes ||
		i.illum < c.illumYes ||
		i.cloud >= c.cloudLow;
	return soft ? "low" : "yes";
}

/**
 * Which fields each provider owns. One procedure serves both providers; the provider's
 * `config.group` says which set it may write, so the position provider never writes a
 * visibility computed without clouds and the visibility provider never rewrites position fields.
 */
const GROUPS: Record<string, readonly string[]> = {
	position: [
		"moonPhase",
		"moonIllumination",
		"moonDirection",
		"moonAzimuth",
		"moonAltitude",
	],
	visibility: ["moonVisibility"],
};

let config: MoonConfig = { ...DEFAULTS };
let fields: Set<string> | null = null;
let owned: Set<string> | null = null;

type MoonProcedureConfig = Partial<MoonConfig> & { group?: string };

/** Called by the host before `map` with the run's fields and the procedure's own config. */
export function configure(
	cfg: ProcedureConfig<MoonProcedureConfig> | null | undefined,
): void {
	fields =
		Array.isArray(cfg?.fields) && cfg.fields.length > 0
			? new Set(cfg.fields)
			: null;
	const { group, ...thresholds } = cfg?.config ?? {};
	owned =
		group !== undefined && GROUPS[group] ? new Set(GROUPS[group]) : null;
	config = { ...DEFAULTS, ...thresholds };
}

export function map(rows: Location[]): Patch<Location>[] {
	const c = config;
	const want = (k: string) =>
		(owned === null || owned.has(k)) && (fields === null || fields.has(k));

	const out: unknown[] = [];
	for (const row of rows) {
		const secs = row.extra?.datetime;
		if (typeof secs !== "number") {
			mma.fail(row.id);
			continue;
		}
		const ms = Math.trunc(secs * 1000);
		if (!isFinite(ms) || Math.abs(ms) > MAX_TIME_MS) {
			mma.fail(row.id);
			continue;
		}
		const date = new Date(ms);

		const moon = SunCalc.getMoonPosition(date, row.lat, row.lng);
		const sun = SunCalc.getPosition(date, row.lat, row.lng);
		const ill = SunCalc.getMoonIllumination(date);

		const moonAlt = moon.altitude * DEG;
		const moonAz = azNorth(moon.azimuth);
		const elongation = separation(
			moonAlt,
			moonAz,
			sun.altitude * DEG,
			azNorth(sun.azimuth),
		);
		const cc = row.extra?.cloudCover;
		const cloud = typeof cc === "number" && isFinite(cc) ? cc : null;

		const patch: Record<string, unknown> = {};
		// Without cloud cover a verdict would silently ignore the weather, so leave it out.
		if (want("moonVisibility") && cloud !== null)
			patch.moonVisibility = visibility(
				{ moonAlt, illum: ill.fraction, elongation, cloud },
				c,
			);
		if (want("moonPhase")) patch.moonPhase = phaseName(ill.phase);
		if (want("moonIllumination"))
			patch.moonIllumination = Math.round(ill.fraction * 100);
		if (want("moonDirection")) patch.moonDirection = direction(moonAz);
		if (want("moonAzimuth")) patch.moonAzimuth = round1(moonAz);
		if (want("moonAltitude")) patch.moonAltitude = round1(moonAlt);
		if (Object.keys(patch).length > 0) out.push({ id: row.id, patch: { extra: patch } });
		else mma.fail(row.id);
	}
	return out as Patch<Location>[];
}
