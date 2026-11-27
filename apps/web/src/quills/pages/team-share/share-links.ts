import { portalHref } from "../../core/portal-href";

interface Domain {
  kind: string;
  domain: string;
  active: boolean;
}

/** The public portal URL: the active custom portal domain, else the portal path on this origin. */
export function portalUrl(
  workspaceId: string,
  origin: string,
  domains: readonly Domain[] = [],
) {
  const custom = domains.find((item) => item.kind === "portal" && item.active);
  return custom
    ? `https://${custom.domain}`
    : new URL(portalHref(workspaceId), origin).href;
}

export type SiteArea = "feedback" | "roadmap" | "changelog";

/**
 * The portal areas that customers can open: the module is on, and the portal navigation
 * does not hide the area. An empty navigation is the default, which shows every area.
 */
export function siteLinks(
  base: string,
  modules: { feedback: boolean; changelog: boolean },
  nav: readonly { type: string; enabled: boolean }[] = [],
): { area: SiteArea; url: string }[] {
  const root = base.replace(/\/+$/, "");
  const areas: [SiteArea, boolean, string][] = [
    ["feedback", modules.feedback, root],
    ["roadmap", modules.feedback, `${root}/roadmap`],
    ["changelog", modules.changelog, `${root}/changelog`],
  ];
  return areas
    .filter(
      ([area, on]) =>
        on && nav.find((item) => item.type === area)?.enabled !== false,
    )
    .map(([area, , url]) => ({ area, url }));
}

export type Network = "x" | "linkedin" | "facebook" | "reddit";

/** The share URL of each network for the portal URL and a short text. */
export function socialLinks(
  url: string,
  text: string,
): Record<Network, string> {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    reddit: `https://www.reddit.com/submit?url=${u}&title=${t}`,
  };
}

function normalizeApiBase(apiBase: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const path = parsed.pathname.replace(/\/+$/, "");
      const withApi = path.endsWith("/api") ? path : `${path}/api`;
      return `${parsed.origin}${withApi}`;
    }
  } catch {
    // Fall through to safe stripped form for non-URL test strings.
  }
  const clean = trimmed.replace(/[\r\n\0]/g, "");
  return clean.endsWith("/api") ? clean : `${clean}/api`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sanitizeInline(value: string): string {
  return value.replace(/[\r\n\t`"'\\]/g, "").trim();
}

/** The script-tag embed of the widget (packages/widget/README.md), in three steps. */
export function widgetSnippets(apiBase: string, workspace: string) {
  const base = normalizeApiBase(apiBase);
  const encoded = encodeURIComponent(workspace);
  const sdk = `${base}/quills-public/${encoded}/widget/sdk.js`;
  return {
    load: [
      "<script>window.Quills=window.Quills||function(){(window.Quills.q=window.Quills.q||[]).push(arguments)};</script>",
      `<script src="${escapeHtmlAttr(sdk)}" defer></script>`,
    ].join("\n"),
    start: [
      "<script>",
      '  Quills("init", { placement: "right" });',
      "</script>",
    ].join("\n"),
    identify: [
      "<script>",
      '  Quills("identify", { ssoToken: "TOKEN_FROM_YOUR_SERVER" });',
      "</script>",
    ].join("\n"),
    serverSign: [
      'import { createHmac } from "node:crypto";',
      "",
      'const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");',
      "",
      "export function signQuillsToken(",
      "  user: { id: string; email: string; name?: string | null; avatarUrl?: string | null },",
      "  secret: string,",
      ") {",
      "  const now = Math.floor(Date.now() / 1000);",
      '  const header = b64({ alg: "HS256", typ: "JWT" });',
      "  const payload = b64({",
      "    sub: user.id,",
      "    email: user.email,",
      "    ...(user.name ? { name: user.name } : {}),",
      "    ...(user.avatarUrl ? { avatarURL: user.avatarUrl } : {}),",
      "    iat: now,",
      "    exp: now + 600,",
      "  });",
      '  const unsigned = [header, payload].join(".");',
      '  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");',
      '  return [unsigned, sig].join(".");',
      "}",
    ].join("\n"),
    proxy: [
      "// next.config.ts (beforeFiles beats catch-all /api routes)",
      "async rewrites() {",
      "  return {",
      "    beforeFiles: [",
      "      {",
      '        source: "/api/quills-public/:path*",',
      `        destination: ${JSON.stringify(`${base}/quills-public/:path*`)},`,
      "      },",
      "    ],",
      "    afterFiles: [],",
      "    fallback: [],",
      "  };",
      "}",
    ].join("\n"),
  };
}

/**
 * Self-contained setup prompt for AI coding agents (Claude Code, Cursor, Codex, Antigravity).
 * Carries only the short-lived pairing code, never the signing secret.
 */
export function aiInstallPrompt(
  apiBase: string,
  workspace: string,
  code: string,
) {
  const base = normalizeApiBase(apiBase);
  const instanceOrigin = base.replace(/\/api$/, "");
  const encoded = encodeURIComponent(workspace);
  const safeWorkspace = sanitizeInline(workspace) || encoded;
  const publicBase = `${base}/quills-public/${encoded}/widget`;
  return [
    `Integrate the Quills support & feedback widget into this app for workspace ${JSON.stringify(safeWorkspace)}.`,
    "",
    "1. Redeem the short-lived install pairing code (works twice, expires in 15 minutes):",
    `   curl -fsS -X POST ${shellQuote(`${publicBase}/install-context`)} \\`,
    "     -H 'Content-Type: application/json' \\",
    `     -d ${shellQuote(JSON.stringify({ code }))}`,
    "   This enables the widget and returns JSON with `signingSecret`, `tabs`, `portalEnabled`,",
    "   `widgetSignIn`, `userAttributes`, and `manualSegments`.",
    "",
    "2. Store secrets safely (CRITICAL):",
    "   - Put `signingSecret` ONLY in a server-side env var `QUILLS_WIDGET_SECRET` (e.g. `.env.local`, gitignored).",
    `   - Put non-secret public settings in \`NEXT_PUBLIC_QUILLS_URL\` / \`VITE_QUILLS_URL\` (${JSON.stringify(instanceOrigin)}, origin without \`/api\`) and \`NEXT_PUBLIC_QUILLS_WORKSPACE\` / \`VITE_QUILLS_WORKSPACE\` (${JSON.stringify(safeWorkspace)}).`,
    "   - NEVER expose `QUILLS_WIDGET_SECRET` in client code, `NEXT_PUBLIC_*` / `VITE_*`, git commits, or logs.",
    "",
    "3. Add a server-side token route (e.g. `GET /api/support/token`):",
    "   - Read the current authenticated user from this app's existing session (return `204` if signed out).",
    "   - Sign an HS256 JWT with `QUILLS_WIDGET_SECRET` (using `node:crypto` HMAC-SHA256, zero extra deps):",
    "     - Required claims: `sub` (stable user ID), `email`, `iat`, `exp` (at most 1 hour after `iat`, e.g. `iat + 600`).",
    "     - Optional claims: `name`, `avatarURL`, `companies: [{ id, name, domain? }]` (`domain` is optional; omit if unavailable),",
    "       and ONLY `traits`/`segments` whose keys/slugs appeared in `userAttributes`/`manualSegments` from step 1.",
    "   - Return `Cache-Control: private, no-store` JSON `{ token }`.",
    "",
    "4. Mount the client widget cleanly in the root app layout:",
    `   - Prefer a same-origin rewrite \`/api/quills-public/:path*\` -> ${JSON.stringify(`${base}/quills-public/:path*`)} (in Next.js, place it in \`rewrites().beforeFiles\` so catch-all \`/api/[...unmatched]\` routes don't intercept it) and load \`/api/quills-public/${encoded}/widget/sdk.js\`; otherwise load ${JSON.stringify(`${publicBase}/sdk.js`)} directly.`,
    "   - Initialize the queue stub `window.Quills = window.Quills || function(){ (window.Quills.q = window.Quills.q || []).push(arguments) }` and call `Quills('init', { theme, locale, tracking })` before loading the script.",
    "   - Exclude embedded/headless iframe routes (e.g. `/embed/*`, `/preview/*`); on client-side navigation into excluded routes call `Quills('close')` and `Quills('hideLauncher')`, and `Quills('showLauncher')` when leaving them.",
    "   - Sync theme (`Quills('setTheme', 'light' | 'dark' | 'auto')`), locale (`Quills('setLocale', locale)`), and analytics consent (`Quills('tracking', granted)`) if the app has them.",
    "   - When signed in, fetch `/api/support/token` and call `Quills('identify', { ssoToken: token })` (NEVER pass unsigned `{ id, email }`). On sign-out, call `Quills('logout')`.",
    "   - If the app has a strict CSP, allow `style-src 'unsafe-inline'` for widget shell styles, `img-src data:` for screenshot capture, and the widget origin in `script-src`, `frame-src`, `connect-src` (not needed if using the same-origin rewrite).",
    "",
    "5. Verify end-to-end before finishing:",
    `   - Confirm \`GET ${publicBase}/config.json\` returns \`"enabled": true\`.`,
    `   - Sign a sample token with your new server helper and \`POST ${publicBase}/verify-token\` with \`{"ssoToken":"..."}\` — confirm HTTP 200, \`valid: true\`, and \`warnings: []\` (read-only, creates no test user).`,
    "   - Run the app's typecheck/tests and verify the launcher renders and opens cleanly with zero console errors.",
  ].join("\n");
}
