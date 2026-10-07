// Helpers callable from templates as {{@name key=value}}. Each returns trusted HTML.
// All drawings are inline SVG that take their colours from CSS variables, so dark mode just works.
import { escapeHtml as esc } from "./template.mjs";

export const placeholder = (key) => `<span class="placeholder">[[${key}]]</span>`;

/** mailto link built from site.config.json; a visible placeholder (release builds refuse it) if the value is missing. */
function email({ label, subject }, { config }) {
  if (!config.supportEmail) return placeholder("supportEmail");
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `<a href="mailto:${esc(config.supportEmail)}${query}">${esc(label ?? config.supportEmail)}</a>`;
}

/** A store/download button. No value in the config yet: a disabled button with a "coming soon" label, never a dead link. */
function button({ key, label, variant = "primary" }, { config, t }) {
  const href = config[key];
  if (href) return `<a class="btn btn-${variant}" href="${esc(href)}" rel="noopener">${esc(label)}</a>`;
  return `<button class="btn btn-${variant} is-soon" type="button" disabled>${esc(label)}<span class="soon">${esc(t.soon)}</span></button>`;
}

/** The effective date from the config, written the way the page's language writes dates. */
function date(_, { config, lang }) {
  if (!config.effectiveDate) return placeholder("effectiveDate");
  const value = new Date(`${config.effectiveDate}T00:00:00Z`);
  const text = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(value);
  return `<time datetime="${esc(config.effectiveDate)}">${esc(text)}</time>`;
}


// ---------------------------------------------------------------------------------------------------------------
// Small decorative icons (24x24, stroke only) and the three signal icons; colour comes from CSS.
const ICONS = {
  trackpad: '<rect x="3" y="6" width="18" height="12" rx="3.5"/><circle cx="12" cy="12" r="1.7"/>',
  underline: '<path d="M5 7.5h14M5 12h9"/><path d="M5 17.5q1.5-1.7 3 0t3 0t3 0t3 0"/>',
  ai: '<path d="M11 4.5l1.9 4.9 4.9 1.9-4.9 1.9L11 18.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.5 15.5v4M16.5 17.5h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="3"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/>',
  wifi: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a8 8 0 0 1 11 0M9.4 16a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19" r=".8"/>',
  sliders: '<path d="M5 8h7M16 8h3M5 16h3M12 16h7"/><circle cx="14" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  warning: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4"/><circle cx="12" cy="17" r=".7"/>',
  mail: '<rect x="3.5" y="6" width="17" height="12" rx="3"/><path d="M4.5 8.2l7.5 5.3 7.5-5.3"/>',
  phone: '<rect x="7" y="3.5" width="10" height="17" rx="3"/><path d="M10.5 17.5h3"/>',
  laptop: '<rect x="5" y="6" width="14" height="9.5" rx="2"/><path d="M3 18.5h18"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
  return: '<path d="M19 6.5v4a3 3 0 0 1-3 3H6.5"/><path d="M10 9.5l-3.7 3.7 3.7 3.7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

function icon({ name }) {
  const body = ICONS[name];
  if (!body) throw new Error(`unknown icon "${name}"`);
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const SIGNAL_ICONS = {
  ok: '<circle cx="12" cy="12" r="9"/><path d="M7.8 12.4l2.9 2.9 5.6-5.8"/>',
  uncertain: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.7a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2.9-1.2 1.9"/><circle cx="12" cy="16.6" r=".8"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.2"/><circle cx="12" cy="16.4" r=".8"/>',
};

/** A status label: icon + text, never colour alone. */
function status({ type, label }) {
  const body = SIGNAL_ICONS[type];
  if (!body) throw new Error(`unknown status "${type}"`);
  return `<span class="status status-${type}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Haptic patterns: taps are narrow tall bars, the hold is a wide low bar (drawn schematically, not to scale).
const HAPTICS = {
  ok: [{ x: 28 }, { x: 46 }],
  uncertain: [{ x: 28 }, { x: 58 }, { x: 88 }],
  error: [{ x: 28 }, { x: 58 }, { x: 88, hold: 52 }],
};

function haptic({ type }) {
  const bars = HAPTICS[type];
  if (!bars) throw new Error(`unknown haptic type "${type}"`);
  const shapes = bars
    .map(({ x, hold }, i) =>
      hold
        ? `<rect class="h-bar h-hold" style="--i:${i}" x="${x}" y="19" width="${hold}" height="22" rx="11"/>`
        : `<rect class="h-bar h-tap" style="--i:${i}" x="${x}" y="8" width="9" height="44" rx="4.5"/>`,
    )
    .join("");
  return `<svg class="haptic-wave" viewBox="0 0 168 60" aria-hidden="true" focusable="false"><line class="h-base" x1="8" y1="30" x2="160" y2="30"/>${shapes}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Gesture glyphs (64x64): dots are fingers, rings are taps, gold arrows are movement.
const R = (n) => (n <= 2 ? 6 : n === 3 ? 5 : 4.5);
const XS = { 1: [32], 2: [22, 42], 3: [18, 32, 46], 4: [12.5, 25.5, 38.5, 51.5] };

function arrow(x1, y1, x2, y2, head = 6) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (angle) => `${(x2 - head * Math.cos(a + angle)).toFixed(1)} ${(y2 - head * Math.sin(a + angle)).toFixed(1)}`;
  return `<path class="g-arrow" d="M${x1} ${y1}L${x2} ${y2}M${p(0.55)}L${x2} ${y2}L${p(-0.55)}"/>`;
}

function dots(n, cy, xs = XS[n]) {
  return xs.map((x) => `<circle class="g-dot" cx="${x}" cy="${cy}" r="${R(n)}"/>`).join("");
}

function rings(n, cy, extra = [3]) {
  return XS[n].map((x) => extra.map((e) => `<circle class="g-ring" cx="${x}" cy="${cy}" r="${R(n) + e}"/>`).join("")).join("");
}

function glyph({ fingers, motion }) {
  const n = Number(fingers);
  let body;
  switch (motion) {
    case "move":
      body = `<circle class="g-dot" cx="20" cy="44" r="6"/>${arrow(27, 37, 50, 14)}`;
      break;
    case "drag": // several fingers moving together from the lower left
      body = dots(n, 46, XS[n].map((x) => x - 6)) + arrow(28, 36, 54, 11);
      break;
    case "tap":
      body = dots(n, 32) + rings(n, 32, [3.5]);
      break;
    case "doubletap":
      body = dots(n, 32) + rings(n, 32, [3, 6.5]);
      break;
    case "hold":
      body = `<circle class="g-dot" cx="32" cy="32" r="6"/><circle class="g-ring g-dash" cx="32" cy="32" r="15"/>`;
      break;
    case "press":
      body = `<circle class="g-dot" cx="32" cy="32" r="6"/><circle class="g-ring" cx="32" cy="32" r="12"/><circle class="g-ring" cx="32" cy="32" r="19" opacity=".5"/>`;
      break;
    case "up":
      body = dots(n, 46) + arrow(32, 35, 32, 9);
      break;
    case "down":
      body = dots(n, 18) + arrow(32, 29, 32, 55);
      break;
    case "left":
      body = dots(n, 22) + arrow(52, 46, 12, 46);
      break;
    case "right":
      body = dots(n, 22) + arrow(12, 46, 52, 46);
      break;
    case "scroll":
      body = dots(n, 32, [20, 36]) + arrow(54, 32, 54, 8, 5) + arrow(54, 32, 54, 56, 5);
      break;
    case "pinch":
      body = dots(2, 32, [24, 40]) + arrow(4, 32, 14, 32, 5) + arrow(60, 32, 50, 32, 5);
      break;
    case "spread":
      body = dots(2, 32, [28, 36]) + arrow(24, 32, 8, 32, 5) + arrow(40, 32, 56, 32, 5);
      break;
    case "edge":
      body = `<rect class="g-edge" x="57" y="8" width="3.5" height="48" rx="1.75"/>${dots(2, 24, [38, 48])}${arrow(52, 46, 10, 46)}`;
      break;
    case "thumb-pinch":
      body = `<circle class="g-dot" cx="14" cy="44" r="4.5"/>${dots(3, 20, [26, 38, 50])}${arrow(10, 56, 20, 50, 4)}${arrow(54, 8, 46, 14, 4)}`;
      break;
    case "thumb-spread":
      body = `<circle class="g-dot" cx="20" cy="40" r="4.5"/>${dots(3, 28, [30, 40, 50])}${arrow(16, 46, 8, 54, 4)}${arrow(48, 18, 56, 10, 4)}`;
      break;
    default:
      throw new Error(`unknown gesture motion "${motion}"`);
  }
  return `<svg class="glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The three pictures of the home page flow: schematic drawings, not screenshots.
const WAVE = "M36 87.5q3-3.5 6 0" + "t6 0".repeat(19);

const ILLUSTRATIONS = {
  // iPhone as a black landscape trackpad with a finger swipe leaving a gold streak.
  phone: `
    <ellipse class="i-shadow" cx="120" cy="130" rx="84" ry="7"/>
    <rect class="i-phone" x="34" y="30" width="172" height="96" rx="17"/>
    <rect class="i-glass" x="40" y="36" width="160" height="84" rx="12"/>
    <rect class="i-island" x="46" y="68" width="5" height="20" rx="2.5"/>
    <path class="i-streak" d="M88 98C112 110 146 98 164 72"/>
    <circle class="i-touch" cx="164" cy="72" r="14"/>
    <circle class="i-touch-core" cx="164" cy="72" r="6"/>`,
  // The Mac: menu-bar app icon at the top right and a cursor on the desktop.
  mac: `
    <rect class="i-lid" x="46" y="20" width="148" height="98" rx="9"/>
    <path class="i-desk" d="M51 30a5 5 0 0 1 5-5h128a5 5 0 0 1 5 5v83a3 3 0 0 1-3 3H54a3 3 0 0 1-3-3z"/>
    <path class="i-menubar" d="M51 30a5 5 0 0 1 5-5h128a5 5 0 0 1 5 5v5H51z"/>
    <ellipse class="i-menu-icon" cx="176" cy="30" rx="4.2" ry="3"/>
    <rect class="i-menu-dot" x="150" y="28.2" width="14" height="3.6" rx="1.8"/>
    <rect class="i-menu-dot" x="62" y="28.2" width="22" height="3.6" rx="1.8"/>
    <path class="i-cursor" d="M104 58v34l9-8 6 13 7-3-6-13h12z"/>
    <path class="i-base" d="M26 122h188l-6 8H32z"/>`,
  // A web page: lines of text, one wrong sentence with a wavy underline, and the hover card with a correction and sources.
  browser: `
    <rect class="i-window" x="20" y="14" width="200" height="124" rx="13"/>
    <path class="i-titlebar" d="M20 27a13 13 0 0 1 13-13h174a13 13 0 0 1 13 13v9H20z"/>
    <circle class="i-dot-a" cx="34" cy="25" r="3"/><circle class="i-dot-b" cx="45" cy="25" r="3"/><circle class="i-dot-c" cx="56" cy="25" r="3"/>
    <rect class="i-line" x="36" y="48" width="150" height="6" rx="3"/>
    <rect class="i-line" x="36" y="62" width="168" height="6" rx="3"/>
    <rect class="i-line i-wrong" x="36" y="76" width="124" height="6" rx="3"/>
    <path class="i-squiggle" pathLength="100" d="${WAVE}"/>
    <rect class="i-line" x="36" y="116" width="140" height="6" rx="3"/>
    <rect class="i-card" x="110" y="90" width="98" height="40" rx="10"/>
    <circle class="i-card-icon" cx="124" cy="104" r="5"/>
    <rect class="i-card-line i-card-strong" x="134" y="101" width="58" height="5" rx="2.5"/>
    <rect class="i-card-line" x="120" y="114" width="76" height="4" rx="2"/>
    <rect class="i-card-link" x="120" y="122" width="40" height="3.5" rx="1.75"/>
    <path class="i-cursor" d="M118 78v18l5-4.5 3.5 7 4-2-3.5-7h7z"/>`,
};

function illustration({ name }) {
  const body = ILLUSTRATIONS[name];
  if (!body) throw new Error(`unknown illustration "${name}"`);
  return `<svg class="illus illus-${name}" viewBox="0 0 240 150" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const helpers = { email, button, date, haptic, glyph, illustration, icon, status };
