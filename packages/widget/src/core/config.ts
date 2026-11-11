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

/** The widget's base path on a Kaneo instance. */
export const widgetBase = (instanceUrl: string, workspace: string) =>
  `${instanceUrl}/api/quills-public/${encodeURIComponent(workspace)}/widget`;

/** The version query keeps this cross-origin GET free of custom-header preflights. */
export async function fetchServerConfig(
  instanceUrl: string,
  workspace: string,
  signal?: AbortSignal,
): Promise<ServerConfig> {
  try {
    const url = `${widgetBase(instanceUrl, workspace)}/config.json?sdk=${encodeURIComponent(SDK_VERSION)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return {};
    // The Quills API wraps the config as { enabled, config }; config is null while the widget is off.
    const body: unknown = await res.json();
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
