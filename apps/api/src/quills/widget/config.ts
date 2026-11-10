import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { bool, parseJson, record, str } from "../settings/area";

// Public boot reads for the widget: its server config, the realtime transport and the locale.
// They carry no identity, so they never read the widget secret or any customer row.

const hexColor = (value: unknown) => {
  const color = str(value)?.trim();
  return color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : null;
};

const widgetConfig = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/widget/config.json",
  operationId: "getQuillsWidgetConfig",
  summary: "Get the public widget configuration",
  description:
    "config is null while the widget is disabled. Identify always needs an ssoToken signed with the widget secret.",
  action: "read",
  response: z.object({
    enabled: z.boolean(),
    config: z
      .object({
        tabs: z.object({
          feedback: z.boolean(),
          changelog: z.boolean(),
          help: z.boolean(),
          messenger: z.boolean(),
          tickets: z.boolean(),
          home: z.boolean(),
        }),
        hmacRequired: z.boolean(),
        visitorAnalytics: z.boolean(),
        visitorDeviceTracking: z.boolean(),
        launcherGreeting: z.string(),
        launcherLabel: z.string(),
        position: z.enum(["left", "right"]),
        theme: z.object({
          themeMode: z.enum(["light", "dark", "user"]),
          lightPrimary: z.string().nullable(),
          lightPrimaryForeground: z.string().nullable(),
          darkPrimary: z.string().nullable(),
          darkPrimaryForeground: z.string().nullable(),
        }),
      })
      .nullable(),
  }),
  responseDescription: "The public widget configuration",
  handler: async ({ db }) => {
    const [row] = await db
      .select({
        widgetConfig: settings.widgetConfig,
        brandingConfig: settings.brandingConfig,
      })
      .from(settings)
      .limit(1);
    const stored = parseJson(row?.widgetConfig ?? null);
    if (stored.enabled !== true) return { enabled: false, config: null };
    // An empty blob takes today's tab defaults, as the settings read does.
    const fresh = Object.keys(stored).length === 0;
    const tabs = record(stored.tabs);
    const branding = parseJson(row?.brandingConfig ?? null);
    const mode = branding.themeMode;
    return {
      enabled: true,
      config: {
        tabs: {
          feedback: bool(tabs.feedback, true),
          changelog: bool(tabs.changelog, fresh),
          help: bool(tabs.help, false),
          messenger: bool(tabs.messenger, fresh),
          tickets: bool(tabs.tickets, true),
          home: bool(tabs.home, true),
        },
        hmacRequired: true,
        visitorAnalytics: bool(stored.visitorAnalytics, true),
        visitorDeviceTracking: bool(stored.visitorDeviceTracking, true),
        launcherGreeting: str(stored.launcherGreeting) ?? "",
        launcherLabel: str(stored.launcherLabel) ?? "",
        position:
          stored.position === "bottom-left"
            ? ("left" as const)
            : ("right" as const),
        theme: {
          themeMode:
            mode === "light" || mode === "dark"
              ? (mode as "light" | "dark")
              : ("user" as const),
          lightPrimary: hexColor(record(branding.light).primary),
          lightPrimaryForeground: hexColor(
            record(branding.light).primaryForeground,
          ),
          darkPrimary: hexColor(record(branding.dark).primary),
          darkPrimaryForeground: hexColor(
            record(branding.dark).primaryForeground,
          ),
        },
      },
    };
  },
});

const capabilities = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/widget/capabilities",
  operationId: "getQuillsWidgetCapabilities",
  summary: "Get the widget's realtime capabilities",
  description: "Kaneo has no Quills chat stream yet, so the widget polls.",
  action: "read",
  response: z.object({
    chat: z.object({
      mode: z.enum(["live", "poll"]),
      pollIntervalMs: z.number(),
    }),
  }),
  responseDescription: "The realtime capabilities",
  handler: async () => ({
    chat: { mode: "poll" as const, pollIntervalMs: 10_000 },
  }),
});

const LOCALES = [
  "en",
  "de",
  "fr",
  "es",
  "ar",
  "ru",
  "pt-br",
  "zh-cn",
  "zh-tw",
  "nl",
  "pl",
  "th",
  "uk",
] as const;
type Locale = (typeof LOCALES)[number];

/** A supported locale for a BCP-47 tag, or null. Same rules as the source's normalizeLocale. */
export function normalizeLocale(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase();
  if ((LOCALES as readonly string[]).includes(lower)) return lower as Locale;
  const [base] = lower.split("-");
  if (base === "zh") {
    try {
      return new Intl.Locale(lower).maximize().script === "Hant"
        ? "zh-tw"
        : "zh-cn";
    } catch {
      return "zh-cn";
    }
  }
  if (base === "pt") return "pt-br";
  return lower.includes("-") && (LOCALES as readonly string[]).includes(base!)
    ? (base as Locale)
    : null;
}

/** The explicit locale when supported, else the best Accept-Language match, else English. */
export function resolveLocale(
  acceptLanguage: string | null,
  explicit?: string,
) {
  const chosen = explicit && normalizeLocale(explicit);
  if (chosen) return chosen;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .slice(0, 20)
    .map((entry) => {
      const [tag = "", q] = entry.trim().split(";");
      const weight = q ? Number.parseFloat(q.replace("q=", "")) : 1;
      return { tag, weight: Number.isNaN(weight) ? 1 : weight };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of ranked) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return "en" as const;
}

const locale = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/widget/locale",
  operationId: "getQuillsWidgetLocale",
  summary: "Resolve the widget locale",
  description:
    "An explicit supported locale wins; otherwise the best Accept-Language match; otherwise en.",
  action: "read",
  query: z.object({ locale: z.string().max(35).optional() }),
  response: z.object({ locale: z.enum(LOCALES) }),
  responseDescription: "The resolved locale",
  handler: async ({ query, acceptLanguage }) => ({
    locale: resolveLocale(acceptLanguage?.slice(0, 1000) ?? null, query.locale),
  }),
});

export default apiRouter()
  .openapi(...widgetConfig)
  .openapi(...capabilities)
  .openapi(...locale);
