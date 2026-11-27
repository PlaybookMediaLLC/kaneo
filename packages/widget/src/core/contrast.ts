// Pure WCAG 2.x color contrast helpers for widget launcher and iframe theming (#317).
// Ensures any admin-selected brand color meets AA contrast (>= 4.5:1 text, >= 3:1 UI).

type Rgb = readonly [number, number, number];

export function parseHexColor(raw: string | undefined | null): Rgb | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return [
      Number.parseInt(clean[0]! + clean[0]!, 16),
      Number.parseInt(clean[1]! + clean[1]!, 16),
      Number.parseInt(clean[2]! + clean[2]!, 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return [
      Number.parseInt(clean.slice(0, 2), 16),
      Number.parseInt(clean.slice(2, 4), 16),
      Number.parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearize(rgb[0]) +
    0.7152 * linearize(rgb[1]) +
    0.0722 * linearize(rgb[2])
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const NEAR_BLACK: Rgb = [0, 0, 0]; // Guarantees >= sqrt(21) ≈ 4.58:1 for every sRGB color.

function roundRgb([r, g, b]: Rgb): Rgb {
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

function toHex(rgb: Rgb): string {
  return (
    "#" +
    roundRgb(rgb)
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return roundRgb([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

/**
 * Returns a foreground hex color guaranteed to meet `minRatio` (default 4.5 for WCAG AA text)
 * against `backgroundHex`. Keeps `preferredFgHex` when it already passes; otherwise nudges it
 * toward black or white, falling back to `#ffffff` or `#111827` (whichever yields higher contrast).
 */
export function ensureAccessibleForeground(
  backgroundHex: string | undefined,
  preferredFgHex?: string,
  minRatio = 4.5,
): string {
  const bg = parseHexColor(backgroundHex);
  if (!bg) return preferredFgHex ?? "#ffffff";
  const pref = parseHexColor(preferredFgHex);
  if (pref && contrastRatio(pref, bg) >= minRatio) {
    return toHex(pref);
  }
  const whiteRatio = contrastRatio(WHITE, bg);
  const darkRatio = contrastRatio(NEAR_BLACK, bg);
  const anchor = whiteRatio >= darkRatio ? WHITE : NEAR_BLACK;
  if (pref) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(mixRgb(pref, anchor, mid), bg) >= minRatio) hi = mid;
      else lo = mid;
    }
    const nudged = mixRgb(pref, anchor, hi);
    if (contrastRatio(nudged, bg) >= minRatio) return toHex(nudged);
  }
  return toHex(anchor);
}

/**
 * Adjusts an accent color so it meets at least `minRatio` against `surfaceHex`
 * (useful for borders, icons, or links rendered directly on a light/dark surface).
 */
export function ensureSurfaceContrast(
  accentHex: string | undefined,
  surfaceHex: string,
  minRatio = 3.0,
): string | undefined {
  const accent = parseHexColor(accentHex);
  const surface = parseHexColor(surfaceHex);
  if (!accent || !surface) return accentHex;
  if (contrastRatio(accent, surface) >= minRatio) return toHex(accent);
  const anchor =
    contrastRatio(WHITE, surface) >= contrastRatio(NEAR_BLACK, surface)
      ? WHITE
      : NEAR_BLACK;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixRgb(accent, anchor, mid), surface) >= minRatio)
      hi = mid;
    else lo = mid;
  }
  const nudged = mixRgb(accent, anchor, hi);
  return toHex(contrastRatio(nudged, surface) >= minRatio ? nudged : anchor);
}
