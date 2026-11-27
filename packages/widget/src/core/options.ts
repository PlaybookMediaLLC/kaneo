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
  instanceUrl: string;
  workspace: string;
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
}

type SafeResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPixels(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 400
  );
}

function parseTheme(value: unknown): SafeResult<ThemeOption> {
  if (value === "auto" || value === "light" || value === "dark") {
    return { success: true, data: value };
  }
  return {
    success: false,
    error: new Error("Quills: theme must be auto, light or dark"),
  };
}

export const themeSchema = {
  safeParse: parseTheme,
  parse(value: unknown): ThemeOption {
    const result = parseTheme(value);
    if (!result.success) throw result.error;
    return result.data;
  },
};

function parseIdentity(value: unknown): SafeResult<RuntimeIdentity> {
  if (!isRecord(value)) {
    return {
      success: false,
      error: new Error("Quills: identity must be an object"),
    };
  }
  if (isNonEmptyString(value.ssoToken)) {
    return { success: true, data: { ssoToken: value.ssoToken } };
  }
  if (value.anonymous === true) {
    return { success: true, data: { anonymous: true } };
  }
  if (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.email) &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.avatarURL === undefined || typeof value.avatarURL === "string")
  ) {
    return {
      success: true,
      data: { ...value } as RuntimeIdentity,
    };
  }
  return {
    success: false,
    error: new Error("Quills: invalid identity payload"),
  };
}

export const identitySchema = {
  safeParse: parseIdentity,
  parse(value: unknown): RuntimeIdentity {
    const result = parseIdentity(value);
    if (!result.success) throw result.error;
    return result.data;
  },
};

function parseInitOptions(value: unknown): SafeResult<RuntimeInitOptions> {
  if (!isRecord(value)) {
    return {
      success: false,
      error: new Error("Quills: init options must be an object"),
    };
  }
  if (
    typeof value.instanceUrl !== "string" ||
    !isSafeHttpUrl(value.instanceUrl)
  ) {
    return {
      success: false,
      error: new Error("Quills: instanceUrl must be an http(s) URL"),
    };
  }
  if (typeof value.workspace !== "string" || !isWorkspaceRef(value.workspace)) {
    return {
      success: false,
      error: new Error("Quills: workspace must be a workspace ID or slug"),
    };
  }
  const out: RuntimeInitOptions = {
    instanceUrl: value.instanceUrl,
    workspace: value.workspace,
  };
  if (value.placement !== undefined) {
    if (value.placement !== "left" && value.placement !== "right") {
      return { success: false, error: new Error("Quills: invalid placement") };
    }
    out.placement = value.placement;
  }
  if (value.defaultBoard !== undefined) {
    if (typeof value.defaultBoard !== "string") {
      return {
        success: false,
        error: new Error("Quills: invalid defaultBoard"),
      };
    }
    out.defaultBoard = value.defaultBoard;
  }
  if (value.container !== undefined) {
    if (!isNonEmptyString(value.container)) {
      return { success: false, error: new Error("Quills: invalid container") };
    }
    out.container = value.container;
  }
  if (value.launcher !== undefined) {
    if (typeof value.launcher === "boolean") {
      out.launcher = value.launcher;
    } else if (
      isRecord(value.launcher) &&
      isNonEmptyString(value.launcher.selector)
    ) {
      out.launcher = { selector: value.launcher.selector };
    } else {
      return {
        success: false,
        error: new Error("Quills: invalid launcher option"),
      };
    }
  }
  if (value.theme !== undefined) {
    const parsed = parseTheme(value.theme);
    if (!parsed.success) return parsed;
    out.theme = parsed.data;
  }
  if (value.announcements !== undefined) {
    if (
      value.announcements !== "whisper" &&
      value.announcements !== "full" &&
      value.announcements !== "none"
    ) {
      return {
        success: false,
        error: new Error("Quills: invalid announcements mode"),
      };
    }
    out.announcements = value.announcements;
  }
  if (value.pageUrl !== undefined) {
    if (
      value.pageUrl !== "path" &&
      value.pageUrl !== "origin" &&
      value.pageUrl !== "none"
    ) {
      return {
        success: false,
        error: new Error("Quills: invalid pageUrl mode"),
      };
    }
    out.pageUrl = value.pageUrl;
  }
  if (value.preload !== undefined) {
    if (value.preload !== "interaction" && value.preload !== "idle") {
      return {
        success: false,
        error: new Error("Quills: invalid preload mode"),
      };
    }
    out.preload = value.preload;
  }
  if (value.offset !== undefined) {
    if (!isRecord(value.offset)) {
      return { success: false, error: new Error("Quills: invalid offset") };
    }
    const offset: { bottom?: number; side?: number } = {};
    if (value.offset.bottom !== undefined) {
      if (!isPixels(value.offset.bottom)) {
        return {
          success: false,
          error: new Error("Quills: invalid offset.bottom"),
        };
      }
      offset.bottom = value.offset.bottom;
    }
    if (value.offset.side !== undefined) {
      if (!isPixels(value.offset.side)) {
        return {
          success: false,
          error: new Error("Quills: invalid offset.side"),
        };
      }
      offset.side = value.offset.side;
    }
    out.offset = offset;
  }
  if (value.locale !== undefined) {
    if (typeof value.locale !== "string") {
      return { success: false, error: new Error("Quills: invalid locale") };
    }
    out.locale = value.locale;
  }
  if (value.identity !== undefined) {
    const parsed = parseIdentity(value.identity);
    if (!parsed.success) return parsed;
    out.identity = parsed.data;
  }
  if (value.tracking !== undefined) {
    if (typeof value.tracking !== "boolean") {
      return {
        success: false,
        error: new Error("Quills: invalid tracking option"),
      };
    }
    out.tracking = value.tracking;
  }
  return { success: true, data: out };
}

export const initOptionsSchema = {
  safeParse: parseInitOptions,
  parse(value: unknown): RuntimeInitOptions {
    const result = parseInitOptions(value);
    if (!result.success) throw result.error;
    return result.data;
  },
};
