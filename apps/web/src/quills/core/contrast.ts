// Pure WCAG 2.x color contrast helpers for PortalShell theming (#317).
// Auto-adjusts admin-chosen brand foreground/background colors to meet WCAG 2.2 AA (>= 4.5:1).

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
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const NEAR_BLACK: Rgb = [0, 0, 0];

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

export function ensureAccessibleForeground(
  backgroundHex: string | undefined,
  preferredFgHex?: string,
  minRatio = 4.5,
): string | undefined {
  const bg = parseHexColor(backgroundHex);
  if (!bg) return preferredFgHex;
  const pref = parseHexColor(preferredFgHex);
  if (pref && contrastRatio(pref, bg) >= minRatio) return toHex(pref);
  const anchor =
    contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg)
      ? WHITE
      : NEAR_BLACK;
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

/** Ensures every foreground/background pair in a portal theme map passes WCAG 2.2 AA contrast. */
export function ensurePortalThemeContrast<T extends Record<string, string>>(
  theme: T,
): T {
  const next: Record<string, string> = { ...theme };
  const pairs: Array<
    readonly [bgKey: string, fgKey: string, minRatio: number]
  > = [
    ["primary", "primaryForeground", 4.5],
    ["background", "foreground", 4.5],
    ["card", "cardForeground", 4.5],
    ["muted", "mutedForeground", 4.5],
    ["accent", "accentForeground", 4.5],
    ["secondary", "secondaryForeground", 4.5],
    ["destructive", "destructiveForeground", 4.5],
  ];
  for (const [bgKey, fgKey, minRatio] of pairs) {
    const bg = next[bgKey];
    const fg = next[fgKey];
    if (bg) {
      const adjusted = ensureAccessibleForeground(
        bg,
        fg || "#ffffff",
        minRatio,
      );
      if (adjusted) next[fgKey] = adjusted;
    }
  }
  return next as T;
}
