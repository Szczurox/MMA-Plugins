// Pointer: one button in the pano viewer that snaps the camera to a chosen target.
//
// MMA currently has no API for adding viewer buttons, so the button is cloned from the
// viewer's screenshot button and inserted before it. Everything the plugin depends on
// (the viewer API, the active location, the screenshot button) is feature-detected,
// and the sidebar's Status section reports what was found, since there are no devtools to check with.
//
// Targets MMA 0.10.x only: newer versions (MMA.Pano, Editor state) are deliberately not handled.

import { useEffect, useState } from "react";

const { registerPlugin, storage, ui } = MMA as any;
const { Sidebar, Section, Field } = ui;

const PLUGIN_ID = "pointer";
const TARGET_KEY = "target";
const BUTTON_ATTR = "data-mma-pointer";
const ICON =
	"M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z";

interface Frame {
	heading: number;
	pitch: number;
}
interface Target {
	id: string;
	label: string;
	/** The camera frame to snap to for this location, or null when the metadata is missing. */
	frame(loc: any): Frame | null;
}

const num = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);
const norm360 = (d: number) => ((d % 360) + 360) % 360;

const TARGETS: Target[] = [
	{
		id: "road",
		label: "Road",
		// The location's stored heading is the direction of the road it was captured facing.
		frame: (loc) =>
			num(loc?.heading)
				? { heading: norm360(loc.heading), pitch: 0 }
				: null,
	},
	{
		id: "moon",
		label: "Moon",
		frame: (loc) => {
			const az = loc?.extra?.moonAzimuth;
			const alt = loc?.extra?.moonAltitude;
			if (!num(az) || !num(alt)) return null;
			return {
				heading: norm360(az),
				pitch: Math.max(-90, Math.min(90, alt)),
			};
		},
	},
];

/** Targets offered in the dropdown: Moon only while the Moon plugin is installed. */
function availableTargets(): Target[] {
	let plugins: any[] | null = null;
	try {
		plugins = (MMA as any).getPlugins?.() ?? null;
	} catch {
		plugins = null;
	}
	const hasMoon =
		plugins === null || plugins.some((p) => p.id === "moon");
	return TARGETS.filter((t) => t.id !== "moon" || hasMoon);
}

function selectedTarget(): Target {
	const id = storage(PLUGIN_ID).get(TARGET_KEY, "road");
	return availableTargets().find((t) => t.id === id) ?? TARGETS[0];
}

/** A location fetched by id, for when the map state names the open one without carrying it. */
let fetched: { id: unknown; loc: any } | null = null;
let fetching: unknown = null;

function activeLocation(): any | null {
	const m = MMA as any;
	try {
		const st = m.getMapState?.();
		const direct = st?.activeLocation ?? m.getActiveLocation?.();
		if (direct) return direct;
		const id = st?.activeLocationId;
		if (id === null || id === undefined) return null;
		if (fetched?.id === id) return fetched?.loc;
		if (fetching !== id && typeof m.fetchLocationsByIds === "function") {
			fetching = id;
			Promise.resolve(m.fetchLocationsByIds([id]))
				.then((rows: any) => {
					const row = Array.isArray(rows)
						? rows[0]
						: (rows?.[0] ?? null);
					fetched = { id, loc: row ?? null };
				})
				.catch(() => {
					fetched = { id, loc: null };
				});
		}
		return null;
	} catch {
		return null;
	}
}

/** The live google.maps.StreetViewPanorama (MMA 0.10.x: MMA.getPanorama). */
function panorama(): any | null {
	try {
		const p = (MMA as any).getPanorama?.();
		return p && typeof p.setPov === "function" ? p : null;
	} catch {
		return null;
	}
}

/** Turn the camera through the panorama's own setPov. */
function turnTo(frame: Frame): boolean {
	const p = panorama();
	if (!p) return false;
	p.setPov({ heading: frame.heading, pitch: frame.pitch });
	return true;
}

const labelOf = (el: Element) =>
	[
		el.getAttribute("aria-label"),
		el.getAttribute("title"),
		el.getAttribute("data-tooltip"),
	]
		.filter(Boolean)
		.join(" | ");

function findScreenshotButton(): HTMLElement | null {
	const buttons = document.querySelectorAll<HTMLElement>(
		"button, [role='button']",
	);
	for (const b of buttons) {
		if (b.hasAttribute(BUTTON_ATTR)) continue;
		if (/screenshot/i.test(labelOf(b))) return b;
	}
	return null;
}

const LABEL_ATTRS = ["aria-label", "title", "data-tooltip"];
const own = (el: Element) => el.hasAttribute(BUTTON_ATTR);

/**
 * The element that is one entry in the viewer's control column: the screenshot button, or the
 * wrapper around it when the button is its only child. Inserting beside this keeps the
 * column's layout and tooltip wiring intact.
 */
function controlUnit(shot: HTMLElement): HTMLElement {
	let unit = shot;
	for (let i = 0; i < 4; i++) {
		const parent = unit.parentElement;
		if (!parent) break;
		const siblings = [...parent.children].filter((c) => !own(c));
		if (siblings.length > 1) break;
		unit = parent;
	}
	return unit;
}

function setLabels(root: HTMLElement, text: string) {
	for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")])
		for (const a of LABEL_ATTRS)
			if (el.hasAttribute(a)) el.setAttribute(a, text);
}

function makeButton(unit: HTMLElement, shot: HTMLElement): HTMLElement {
	// Deep copy keeps the wrapper structure and classes; none of the original's event
	// listeners come along, so the copy is inert until given its own behaviour below.
	const copy = unit.cloneNode(true) as HTMLElement;
	copy.setAttribute(BUTTON_ATTR, "");
	for (const el of [copy, ...copy.querySelectorAll("[id]")])
		el.removeAttribute("id");

	// Find the copy of the screenshot button by its path inside the unit.
	let inner: HTMLElement = copy;
	if (unit !== shot) {
		const path: number[] = [];
		for (
			let el: HTMLElement | null = shot;
			el && el !== unit;
			el = el.parentElement
		)
			path.unshift([...(el.parentElement?.children ?? [])].indexOf(el));
		for (const i of path) inner = inner.children[i] as HTMLElement;
	}
	inner.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="${ICON}"/></svg>`;

	copy.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const frame = selectedTarget().frame(activeLocation());
		if (frame) turnTo(frame);
	});
	return copy;
}

/** Add, update or remove the viewer button so it matches the current target and location. */
function sync() {
	const existing = document.querySelector<HTMLElement>(`[${BUTTON_ATTR}]`);
	const target = selectedTarget();
	const frame = target.frame(activeLocation());
	const shot = frame ? findScreenshotButton() : null;

	if (!frame || !shot) {
		existing?.remove();
		return;
	}
	const unit = controlUnit(shot);
	let btn = existing;
	if (!btn || btn.nextElementSibling !== unit) {
		btn?.remove();
		btn = makeButton(unit, shot);
		unit.parentElement?.insertBefore(btn, unit);
	}
	const text = `Point to ${target.label}`;
	if (btn.getAttribute("data-mma-pointer-text") !== text) {
		btn.setAttribute("data-mma-pointer-text", text);
		setLabels(btn, text);
	}
}

let queued = false;
const schedule = () => {
	if (queued) return;
	queued = true;
	requestAnimationFrame(() => {
		queued = false;
		sync();
	});
};

function start() {
	const observer = new MutationObserver(schedule);
	observer.observe(document.body, { childList: true, subtree: true });
	const poll = window.setInterval(schedule, 500); // location changes need not touch the DOM
	schedule();
	return () => {
		observer.disconnect();
		window.clearInterval(poll);
		document.querySelector(`[${BUTTON_ATTR}]`)?.remove();
	};
}

/** Live status, so a viewer that stops showing the button can be told apart from missing data. */
function Status() {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = window.setInterval(() => tick((n) => n + 1), 1000);
		return () => window.clearInterval(t);
	}, []);

	const loc = activeLocation();
	const rows: [string, string][] = [
		["Camera control", panorama() ? "available" : "NOT available"],
		["Open location", loc ? "yes" : "none"],
		["Road data", num(loc?.heading) ? "yes" : "no"],
		["Moon data", TARGETS[1].frame(loc) ? "yes" : "no"],
		["Screenshot button", findScreenshotButton() ? "found" : "NOT found"],
	];
	return (
		<Section title="Status">
			{rows.map(([k, v]) => (
				<div key={k} style={{ fontSize: 12, opacity: 0.85 }}>
					<b>{k}:</b> {v}
				</div>
			))}
		</Section>
	);
}

function PointerSidebar({ onClose }: { onClose: () => void }) {
	const options = availableTargets();
	const [value, setValue] = useState(selectedTarget().id);
	return (
		<Sidebar title="Pointer" onBack={onClose}>
			<Section title="Target">
				<Field label="Point the viewer towards">
					<select
						value={value}
						onChange={(e) => {
							setValue(e.target.value);
							storage(PLUGIN_ID).set(TARGET_KEY, e.target.value);
							schedule();
						}}
						style={{ width: "100%" }}
					>
						{options.map((t) => (
							<option key={t.id} value={t.id}>
								{t.label}
							</option>
						))}
					</select>
				</Field>
				<div style={{ fontSize: 12, opacity: 0.7 }}>
					The button appears next to the screenshot button only when
					the open location has data for the chosen target.
				</div>
			</Section>
			<Status />
		</Sidebar>
	);
}

registerPlugin({
	sidebar: PointerSidebar,
	activate() {
		return start();
	},
});
