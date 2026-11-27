import * as z from "zod/mini";

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

export const identitySchema = z.union([
  z.object({ ssoToken: z.string().check(z.minLength(1)) }),
  z.looseObject({
    id: z.string().check(z.minLength(1)),
    email: z.string().check(z.minLength(1)),
    name: z.optional(z.string()),
    avatarURL: z.optional(z.string()),
  }),
  z.object({ anonymous: z.literal(true) }),
]);

export const themeSchema = z.enum(["auto", "light", "dark"]);
/** Launcher distance from the viewport edges. */
const pixels = z.number().check(z.minimum(0), z.maximum(400));

export const initOptionsSchema = z
  .object({
    instanceUrl: z.optional(
      z
        .string()
        .check(
          z.refine(isSafeHttpUrl, "Quills: instanceUrl must be an http(s) URL"),
        ),
    ),
    workspace: z.optional(
      z
        .string()
        .check(
          z.refine(
            isWorkspaceRef,
            "Quills: workspace must be a workspace ID or slug",
          ),
        ),
    ),
    placement: z.optional(z.enum(["left", "right"])),
    defaultBoard: z.optional(z.string()),
    container: z.optional(z.string().check(z.minLength(1))),
    launcher: z.optional(
      z.union([
        z.boolean(),
        z.object({ selector: z.string().check(z.minLength(1)) }),
      ]),
    ),
    theme: z.optional(themeSchema),
    announcements: z.optional(z.enum(["whisper", "full", "none"])),
    pageUrl: z.optional(z.enum(["path", "origin", "none"])),
    offset: z.optional(
      z.object({ bottom: z.optional(pixels), side: z.optional(pixels) }),
    ),
    locale: z.optional(z.string()),
    identity: z.optional(identitySchema),
    tracking: z.optional(z.boolean()),
    /** Custom widget domain or reverse-proxy base URL (e.g. "https://support.acme.com/widget" or "/support-widget") (#318). */
    baseUrl: z.optional(
      z
        .string()
        .check(
          z.refine(
            (v) =>
              isSafeHttpUrl(v) || (v.startsWith("/") && !v.startsWith("//")),
            "Quills: baseUrl must be an http(s) URL or root-relative path",
          ),
        ),
    ),
    /** Optional support email for graceful fallback link when the widget fails to load (#318). */
    fallbackEmail: z.optional(
      z.string().check(
        z.minLength(3),
        z.maxLength(320),
        z.refine(
          (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
          "Quills: fallbackEmail must be a valid email address",
        ),
      ),
    ),
    /** Milliseconds to wait for the widget iframe before triggering fallback/onLoadError (default 3000) (#318). */
    loadTimeoutMs: z.optional(
      z.number().check(z.minimum(250), z.maximum(30000)),
    ),
  })
  .check(
    z.refine(
      (o) => Boolean(o.baseUrl || (o.instanceUrl && o.workspace)),
      "Quills: provide baseUrl or both instanceUrl and workspace",
    ),
  );

export type RuntimeInitOptions = z.infer<typeof initOptionsSchema>;
