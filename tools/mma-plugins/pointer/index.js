var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// mma-ext:react
var require_react = __commonJS({
  "mma-ext:react"(exports, module) {
    module.exports = globalThis.__mma_require("react");
  }
});

// mma-ext:react/jsx-runtime
var require_jsx_runtime = __commonJS({
  "mma-ext:react/jsx-runtime"(exports, module) {
    module.exports = globalThis.__mma_require("react/jsx-runtime");
  }
});

// pointer/src/index.tsx
var import_react = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var { registerPlugin, storage, ui } = MMA;
var { Sidebar, Section, Field } = ui;
var PLUGIN_ID = "pointer";
var TARGET_KEY = "target";
var BUTTON_ATTR = "data-mma-pointer";
var ICON = "M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z";
var num = (v) => typeof v === "number" && Number.isFinite(v);
var norm360 = (d) => (d % 360 + 360) % 360;
var TARGETS = [
  {
    id: "road",
    label: "Road",
    // The location's stored heading is the direction of the road it was captured facing.
    frame: (loc) => num(loc?.heading) ? { heading: norm360(loc.heading), pitch: 0 } : null
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
        pitch: Math.max(-90, Math.min(90, alt))
      };
    }
  }
];
function availableTargets() {
  let plugins = null;
  try {
    plugins = MMA.getPlugins?.() ?? null;
  } catch {
    plugins = null;
  }
  const hasMoon = plugins === null || plugins.some((p) => p.id === "moon");
  return TARGETS.filter((t) => t.id !== "moon" || hasMoon);
}
function selectedTarget() {
  const id = storage(PLUGIN_ID).get(TARGET_KEY, "road");
  return availableTargets().find((t) => t.id === id) ?? TARGETS[0];
}
var fetched = null;
var fetching = null;
function activeLocation() {
  const m = MMA;
  try {
    const st = m.getMapState?.();
    const direct = st?.activeLocation ?? m.getActiveLocation?.();
    if (direct) return direct;
    const id = st?.activeLocationId;
    if (id === null || id === void 0) return null;
    if (fetched?.id === id) return fetched?.loc;
    if (fetching !== id && typeof m.fetchLocationsByIds === "function") {
      fetching = id;
      Promise.resolve(m.fetchLocationsByIds([id])).then((rows) => {
        const row = Array.isArray(rows) ? rows[0] : rows?.[0] ?? null;
        fetched = { id, loc: row ?? null };
      }).catch(() => {
        fetched = { id, loc: null };
      });
    }
    return null;
  } catch {
    return null;
  }
}
function panorama() {
  try {
    const p = MMA.getPanorama?.();
    return p && typeof p.setPov === "function" ? p : null;
  } catch {
    return null;
  }
}
function turnTo(frame) {
  const p = panorama();
  if (!p) return false;
  p.setPov({ heading: frame.heading, pitch: frame.pitch });
  return true;
}
var labelOf = (el) => [
  el.getAttribute("aria-label"),
  el.getAttribute("title"),
  el.getAttribute("data-tooltip")
].filter(Boolean).join(" | ");
function findScreenshotButton() {
  const buttons = document.querySelectorAll(
    "button, [role='button']"
  );
  for (const b of buttons) {
    if (b.hasAttribute(BUTTON_ATTR)) continue;
    if (/screenshot/i.test(labelOf(b))) return b;
  }
  return null;
}
var LABEL_ATTRS = ["aria-label", "title", "data-tooltip"];
var own = (el) => el.hasAttribute(BUTTON_ATTR);
function controlUnit(shot) {
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
function setLabels(root, text) {
  for (const el of [root, ...root.querySelectorAll("*")])
    for (const a of LABEL_ATTRS)
      if (el.hasAttribute(a)) el.setAttribute(a, text);
}
function makeButton(unit, shot) {
  const copy = unit.cloneNode(true);
  copy.setAttribute(BUTTON_ATTR, "");
  for (const el of [copy, ...copy.querySelectorAll("[id]")])
    el.removeAttribute("id");
  let inner = copy;
  if (unit !== shot) {
    const path = [];
    for (let el = shot; el && el !== unit; el = el.parentElement)
      path.unshift([...el.parentElement?.children ?? []].indexOf(el));
    for (const i of path) inner = inner.children[i];
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
function sync() {
  const existing = document.querySelector(`[${BUTTON_ATTR}]`);
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
var queued = false;
var schedule = () => {
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
  const poll = window.setInterval(schedule, 500);
  schedule();
  return () => {
    observer.disconnect();
    window.clearInterval(poll);
    document.querySelector(`[${BUTTON_ATTR}]`)?.remove();
  };
}
function Status() {
  const [, tick] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1e3);
    return () => window.clearInterval(t);
  }, []);
  const loc = activeLocation();
  const rows = [
    ["Camera control", panorama() ? "available" : "NOT available"],
    ["Open location", loc ? "yes" : "none"],
    ["Road data", num(loc?.heading) ? "yes" : "no"],
    ["Moon data", TARGETS[1].frame(loc) ? "yes" : "no"],
    ["Screenshot button", findScreenshotButton() ? "found" : "NOT found"]
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { title: "Status", children: rows.map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, opacity: 0.85 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
      k,
      ":"
    ] }),
    " ",
    v
  ] }, k)) });
}
function PointerSidebar({ onClose }) {
  const options = availableTargets();
  const [value, setValue] = (0, import_react.useState)(selectedTarget().id);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Sidebar, { title: "Pointer", onBack: onClose, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { title: "Target", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "Point the viewer towards", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "select",
        {
          value,
          onChange: (e) => {
            setValue(e.target.value);
            storage(PLUGIN_ID).set(TARGET_KEY, e.target.value);
            schedule();
          },
          style: { width: "100%" },
          children: options.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: t.id, children: t.label }, t.id))
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.7 }, children: "The button appears next to the screenshot button only when the open location has data for the chosen target." })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {})
  ] });
}
registerPlugin({
  sidebar: PointerSidebar,
  activate() {
    return start();
  }
});
