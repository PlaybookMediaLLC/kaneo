import * as z from "zod/mini";
import { SDK_VERSION } from "../version.js";

/** Unknown config fields are ignored; malformed known fields fail closed. */
export const serverConfigSchema = z.object({
  theme: z.optional(
    z.object({
      lightPrimary: z.optional(z.string()),
      lightPrimaryForeground: z.optional(z.string()),
      darkPrimary: z.optional(z.string()),
      darkPrimaryForeground: z.optional(z.string()),
      themeMode: z.optional(z.enum(["light", "dark", "user"])),
    }),
  ),
  tabs: z.optional(
    z.object({
      feedback: z.optional(z.boolean()),
      changelog: z.optional(z.boolean()),
      help: z.optional(z.boolean()),
      chat: z.optional(z.boolean()),
      tickets: z.optional(z.boolean()),
    }),
  ),
  imageUploadsInWidget: z.optional(z.boolean()),
  hmacRequired: z.optional(z.boolean()),
  visitorAnalytics: z.optional(z.boolean()),
  visitorDeviceTracking: z.optional(z.boolean()),
  launcherGreeting: z.nullish(z.string()),
  launcherLabel: z.nullish(z.string()),
  position: z.optional(z.enum(["left", "right"])),
});
export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** The widget's base path on a Kaneo instance, custom domain, or reverse proxy (#318). */
export const widgetBase = (
  instanceUrl?: string,
  workspace?: string,
  baseUrl?: string,
) =>
  baseUrl
    ? baseUrl.replace(/\/+$/, "")
    : `${(instanceUrl ?? "").replace(/\/+$/, "")}/api/quills-public/${encodeURIComponent(workspace ?? "")}/widget`;

/**
 * Null when the instance says the widget is off or the workspace does not exist; `{}` when the
 * config could not be read, so a transient failure still shows the launcher. The version query
 * keeps this cross-origin GET free of custom-header preflights. Uses `credentials: "omit"` for
 * zero-cookie operation (#318).
 */
export async function fetchServerConfig(
  instanceUrl?: string,
  workspace?: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ServerConfig | null> {
  try {
    const url = `${widgetBase(instanceUrl, workspace, baseUrl)}/config.json?sdk=${encodeURIComponent(SDK_VERSION)}`;
    const res = await fetch(url, { signal, credentials: "omit" });
    if (res.status === 404) return null;
    if (!res.ok) return {};
    // The Quills API wraps the config as { enabled, config }; config is null while the widget is off.
    const body: unknown = await res.json();
    if ((body as { enabled?: unknown } | null)?.enabled === false) return null;
    const parsed = serverConfigSchema.safeParse(
      body && typeof body === "object"
        ? (body as { config?: unknown }).config
        : body,
    );
    if (!parsed.success) return {};
    // Kaneo has no pageview ingest route yet: keep host-page analytics and the device ID off.
    const {
      visitorAnalytics: _a,
      visitorDeviceTracking: _d,
      ...config
    } = parsed.data;
    return config;
  } catch {
    return {};
  }
}
