// Zero-dependency runtime option validators for the host facade (#316).
// Keeps sdk.js well under the 15 KB gzipped budget without bundling Zod on the host page.

export function isSafeHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** A Kaneo workspace ID or slug: one URL path segment. */
export const isWorkspaceRef = (raw: string) =>
  /^[A-Za-z0-9_-]{1,200}$/.test(raw);

export type ThemeOption = "auto" | "light" | "dark";

export type RuntimeIdentity =
  | { ssoToken: string }
  | ({
      id: string;
      email: string;
      name?: string;
      avatarURL?: string;
    } & Record<string, unknown>)
  | { anonymous: true };

export interface RuntimeInitOptions {
  instanceUrl?: string;
  workspace?: string;
  placement?: "left" | "right";
  defaultBoard?: string;
  container?: string;
  launcher?: boolean | { selector: string };
  theme?: ThemeOption;
  announcements?: "whisper" | "full" | "none";
  pageUrl?: "path" | "origin" | "none";
  preload?: "interaction" | "idle";
  offset?: { bottom?: number; side?: number };
  locale?: string;
  identity?: RuntimeIdentity;
  tracking?: boolean;
  /** Custom widget domain or reverse-proxy base URL (e.g. "https://support.acme.com/widget" or "/support-widget") (#318). */
  baseUrl?: string;
  /** Optional support email for graceful fallback link when the widget fails to load (#318). */
  fallbackEmail?: string;
  /** Milliseconds to wait for the widget iframe before triggering fallback/onLoadError (default 3000) (#318). */
  loadTimeoutMs?: number;
}

type SafeResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmpty = (v: unknown): v is string => isStr(v) && v.length > 0;
const isPx = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 400;
const ok = <T>(data: T): SafeResult<T> => ({ success: true, data });
const err = (msg: string): SafeResult<never> => ({
  success: false,
  error: new Error(`Quills: ${msg}`),
});
const makeSchema = <T>(safeParse: (v: unknown) => SafeResult<T>) => ({
  safeParse,
  parse(v: unknown): T {
    const r = safeParse(v);
    if (!r.success) throw r.error;
    return r.data;
  },
});

const parseTheme = (v: unknown): SafeResult<ThemeOption> =>
  v === "auto" || v === "light" || v === "dark"
    ? ok(v)
    : err("theme must be auto, light or dark");

export const themeSchema = makeSchema(parseTheme);

function parseIdentity(v: unknown): SafeResult<RuntimeIdentity> {
  if (!isRec(v)) return err("identity must be an object");
  if (isNonEmpty(v.ssoToken)) return ok({ ssoToken: v.ssoToken });
  if (v.anonymous === true) return ok({ anonymous: true });
  if (
    isNonEmpty(v.id) &&
    isNonEmpty(v.email) &&
    (v.name === undefined || isStr(v.name)) &&
    (v.avatarURL === undefined || isStr(v.avatarURL))
  ) {
    return ok({ ...v } as RuntimeIdentity);
  }
  return err("invalid identity payload");
}

export const identitySchema = makeSchema(parseIdentity);

function parseInitOptions(v: unknown): SafeResult<RuntimeInitOptions> {
  if (!isRec(v)) return err("init options must be an object");
  const out: RuntimeInitOptions = {};
  if (v.instanceUrl !== undefined) {
    if (!isStr(v.instanceUrl) || !isSafeHttpUrl(v.instanceUrl))
      return err("instanceUrl must be an http(s) URL");
    out.instanceUrl = v.instanceUrl;
  }
  if (v.workspace !== undefined) {
    if (!isStr(v.workspace) || !isWorkspaceRef(v.workspace))
      return err("workspace must be a workspace ID or slug");
    out.workspace = v.workspace;
  }
  if (v.baseUrl !== undefined) {
    if (
      !isStr(v.baseUrl) ||
      !(
        isSafeHttpUrl(v.baseUrl) ||
        (v.baseUrl.startsWith("/") && !v.baseUrl.startsWith("//"))
      )
    )
      return err("baseUrl must be an http(s) URL or root-relative path");
    out.baseUrl = v.baseUrl;
  }
  if (!(out.baseUrl || (out.instanceUrl && out.workspace)))
    return err("provide baseUrl or both instanceUrl and workspace");
  if (v.fallbackEmail !== undefined) {
    if (
      !isStr(v.fallbackEmail) ||
      v.fallbackEmail.length < 3 ||
      v.fallbackEmail.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.fallbackEmail.trim())
    )
      return err("fallbackEmail must be a valid email address");
    out.fallbackEmail = v.fallbackEmail;
  }
  if (v.loadTimeoutMs !== undefined) {
    if (
      typeof v.loadTimeoutMs !== "number" ||
      !Number.isFinite(v.loadTimeoutMs) ||
      v.loadTimeoutMs < 250 ||
      v.loadTimeoutMs > 30000
    )
      return err("invalid loadTimeoutMs");
    out.loadTimeoutMs = v.loadTimeoutMs;
  }
  if (v.placement !== undefined) {
    if (v.placement !== "left" && v.placement !== "right")
      return err("invalid placement");
    out.placement = v.placement;
  }
  if (v.defaultBoard !== undefined) {
    if (!isStr(v.defaultBoard)) return err("invalid defaultBoard");
    out.defaultBoard = v.defaultBoard;
  }
  if (v.container !== undefined) {
    if (!isNonEmpty(v.container)) return err("invalid container");
    out.container = v.container;
  }
  if (v.launcher !== undefined) {
    if (typeof v.launcher === "boolean") out.launcher = v.launcher;
    else if (isRec(v.launcher) && isNonEmpty(v.launcher.selector))
      out.launcher = { selector: v.launcher.selector };
    else return err("invalid launcher option");
  }
  if (v.theme !== undefined) {
    const r = parseTheme(v.theme);
    if (!r.success) return r;
    out.theme = r.data;
  }
  if (v.announcements !== undefined) {
    if (
      v.announcements !== "whisper" &&
      v.announcements !== "full" &&
      v.announcements !== "none"
    )
      return err("invalid announcements mode");
    out.announcements = v.announcements;
  }
  if (v.pageUrl !== undefined) {
    if (v.pageUrl !== "path" && v.pageUrl !== "origin" && v.pageUrl !== "none")
      return err("invalid pageUrl mode");
    out.pageUrl = v.pageUrl;
  }
  if (v.preload !== undefined) {
    if (v.preload !== "interaction" && v.preload !== "idle")
      return err("invalid preload mode");
    out.preload = v.preload;
  }
  if (v.offset !== undefined) {
    if (!isRec(v.offset)) return err("invalid offset");
    const offset: { bottom?: number; side?: number } = {};
    if (v.offset.bottom !== undefined) {
      if (!isPx(v.offset.bottom)) return err("invalid offset.bottom");
      offset.bottom = v.offset.bottom;
    }
    if (v.offset.side !== undefined) {
      if (!isPx(v.offset.side)) return err("invalid offset.side");
      offset.side = v.offset.side;
    }
    out.offset = offset;
  }
  if (v.locale !== undefined) {
    if (!isStr(v.locale)) return err("invalid locale");
    out.locale = v.locale;
  }
  if (v.identity !== undefined) {
    const r = parseIdentity(v.identity);
    if (!r.success) return r;
    out.identity = r.data;
  }
  if (v.tracking !== undefined) {
    if (typeof v.tracking !== "boolean") return err("invalid tracking option");
    out.tracking = v.tracking;
  }
  return ok(out);
}

export const initOptionsSchema = makeSchema(parseInitOptions);
