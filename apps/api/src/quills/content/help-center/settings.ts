import { apiRouter, z, type BaseVariables } from "../../../openapi";
import { defineQuillsRoute } from "../../framework/define-route";
import { someField } from "../../feedback/schemas";
import { defined } from "../../settings/area";
import {
  DEFAULT_LOCALE,
  locale,
  notFound,
  readConfig,
  writeConfig,
  type HelpCenterConfig,
} from "./shared";

// Stored in settings.help_center_config, as in Quackback. The custom domain belongs to
// another phase: these routes never read or write it, and a write keeps it as stored.

const chromeFields = {
  homepageTitle: z.string().trim().max(200),
  homepageDescription: z.string().trim().max(500),
  searchPlaceholder: z.string().trim().max(200),
};
const response = z
  .object({
    homepageTitle: z.string(),
    homepageDescription: z.string(),
    headerLinks: z.array(z.object({ label: z.string(), url: z.string() })),
    locales: z.object({
      default: z.string(),
      additional: z.array(z.string()),
      chrome: z.array(
        z.object({
          locale: z.string(),
          homepageTitle: z.string(),
          homepageDescription: z.string(),
          searchPlaceholder: z.string(),
        }),
      ),
    }),
    autoTranslate: z.object({
      enabled: z.boolean().openapi({
        description:
          "Stored only: a publish records the request, and no translation runs in Kaneo yet",
      }),
      protectedTerms: z.array(z.string()),
    }),
    seo: z.object({
      metaDescription: z.string(),
      sitemapEnabled: z.boolean(),
      structuredDataEnabled: z.boolean(),
      indexable: z.boolean(),
    }),
  })
  .openapi("QuillsHelpCenterSettings");

const view = (config: HelpCenterConfig): z.input<typeof response> => ({
  homepageTitle: config.homepageTitle,
  homepageDescription: config.homepageDescription,
  headerLinks: config.headerLinks.map(({ label, url }) => ({ label, url })),
  locales: {
    default: DEFAULT_LOCALE,
    additional: config.locales.additional,
    chrome: config.locales.additional.map((code) => ({
      locale: code,
      homepageTitle: config.locales.chrome[code]?.homepageTitle ?? "",
      homepageDescription:
        config.locales.chrome[code]?.homepageDescription ?? "",
      searchPlaceholder: config.locales.chrome[code]?.searchPlaceholder ?? "",
    })),
  },
  autoTranslate: {
    enabled: config.autoTranslate.enabled,
    protectedTerms: config.autoTranslate.protectedTerms,
  },
  seo: {
    metaDescription: config.seo.metaDescription,
    sitemapEnabled: config.seo.sitemapEnabled,
    structuredDataEnabled: config.seo.structuredDataEnabled,
    indexable: config.seo.indexable,
  },
});
const errors = { 409: "Stored help-center settings are not a JSON object" };
const changeEvent = (change: string, code?: string) => ({
  type: "settings.help_center_updated" as const,
  entityType: "settings" as const,
  entityId: "help_center",
  payload: (code ? { change, locale: code } : { change }) as Record<
    string,
    string
  >,
});
const additionalLocale = locale.refine(
  (code) => code !== DEFAULT_LOCALE,
  "The default locale is always enabled",
);

const getSettings = defineQuillsRoute({
  method: "get",
  path: "/help-center/settings",
  operationId: "getQuillsHelpCenterSettings",
  summary: "Get help-center settings",
  action: "read",
  response,
  responseDescription: "Help-center settings with defaults applied",
  handler: async ({ db }) => view(await readConfig(db)),
});

const updateSettings = defineQuillsRoute({
  method: "patch",
  path: "/help-center/settings",
  operationId: "updateQuillsHelpCenterSettings",
  summary: "Update help-center homepage, header links, SEO and auto-translate",
  description:
    "Header links replace the stored list. SEO and auto-translate fields merge over the stored values.",
  action: "manage_settings",
  body: z
    .object({
      homepageTitle: z.string().trim().min(1).max(200).optional(),
      homepageDescription: z.string().trim().max(500).optional(),
      headerLinks: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(60),
            url: z
              .string()
              .min(1)
              .max(500)
              .refine(
                (url) => url.startsWith("/") || /^https?:\/\//i.test(url),
                "URL must be an absolute http(s) URL or start with /",
              ),
          }),
        )
        .max(3)
        .optional(),
      seo: z
        .object({
          metaDescription: z.string().max(500).optional(),
          structuredDataEnabled: z.boolean().optional(),
          indexable: z.boolean().optional(),
        })
        .optional(),
      autoTranslate: z
        .object({
          enabled: z.boolean().optional(),
          protectedTerms: z
            .array(z.string().trim().min(1).max(100))
            .max(100)
            .optional(),
        })
        .optional(),
    })
    .refine(someField, "Change at least one field"),
  response,
  responseDescription: "The updated settings",
  errors,
  event: () => changeEvent("settings"),
  handler: async ({ db, body }) =>
    view(
      await writeConfig(db, (config) =>
        defined({
          homepageTitle: body.homepageTitle,
          homepageDescription: body.homepageDescription,
          headerLinks: body.headerLinks?.map(({ label, url }) => ({
            label,
            url,
          })),
          seo: body.seo && {
            ...config.seo,
            ...defined({
              metaDescription: body.seo.metaDescription,
              structuredDataEnabled: body.seo.structuredDataEnabled,
              indexable: body.seo.indexable,
            }),
          },
          autoTranslate: body.autoTranslate && {
            ...config.autoTranslate,
            ...defined({
              enabled: body.autoTranslate.enabled,
              protectedTerms: body.autoTranslate.protectedTerms,
            }),
          },
        }),
      ),
    ),
});

const enableLocale = defineQuillsRoute({
  method: "put",
  path: "/help-center/settings/locales",
  operationId: "enableQuillsHelpCenterLocale",
  summary: "Enable an additional help-center locale with its homepage text",
  description:
    "Needs a homepage title. Enabling an enabled locale replaces its text. Existing translations come back.",
  action: "manage_settings",
  body: z.object({
    locale: additionalLocale,
    chrome: z.object({
      ...chromeFields,
      homepageTitle: chromeFields.homepageTitle.min(1),
    }),
  }),
  response,
  responseDescription: "The updated settings",
  errors,
  event: ({ body }) => changeEvent("locale_enabled", body.locale),
  handler: async ({ db, body }) =>
    view(
      await writeConfig(db, (config) => ({
        locales: {
          ...config.locales,
          additional: config.locales.additional.includes(body.locale)
            ? config.locales.additional
            : [...config.locales.additional, body.locale],
          chrome: {
            ...config.locales.chrome,
            [body.locale]: {
              homepageTitle: body.chrome.homepageTitle,
              homepageDescription: body.chrome.homepageDescription,
              searchPlaceholder: body.chrome.searchPlaceholder,
            },
          },
        },
      })),
    ),
});

const updateLocaleChrome = defineQuillsRoute({
  method: "patch",
  path: "/help-center/settings/locales",
  operationId: "updateQuillsHelpCenterLocaleChrome",
  summary: "Update the homepage text of an enabled help-center locale",
  action: "manage_settings",
  body: z.object({
    locale: additionalLocale,
    chrome: z
      .object({
        homepageTitle: chromeFields.homepageTitle.optional(),
        homepageDescription: chromeFields.homepageDescription.optional(),
        searchPlaceholder: chromeFields.searchPlaceholder.optional(),
      })
      .refine(someField, "Change at least one field"),
  }),
  response,
  responseDescription: "The updated settings",
  errors: { ...errors, 404: "The locale is not enabled" },
  event: ({ body }) => changeEvent("locale_updated", body.locale),
  handler: async ({ db, body }) =>
    view(
      await writeConfig(db, (config) => {
        if (!config.locales.additional.includes(body.locale))
          throw notFound("Enabled locale");
        const current = config.locales.chrome[body.locale] ?? {
          homepageTitle: "",
          homepageDescription: "",
          searchPlaceholder: "",
        };
        return {
          locales: {
            ...config.locales,
            chrome: {
              ...config.locales.chrome,
              [body.locale]: { ...current, ...defined(body.chrome) },
            },
          },
        };
      }),
    ),
});

const disableLocale = defineQuillsRoute({
  method: "delete",
  path: "/help-center/settings/locales",
  operationId: "disableQuillsHelpCenterLocale",
  summary: "Disable an additional help-center locale",
  description: "Its translations and homepage text stay for a later re-enable.",
  action: "manage_settings",
  query: z.object({ locale: additionalLocale }),
  response,
  responseDescription: "The updated settings",
  errors: { ...errors, 404: "The locale is not enabled" },
  event: ({ query }) => changeEvent("locale_disabled", query.locale),
  handler: async ({ db, query }) =>
    view(
      await writeConfig(db, (config) => {
        if (!config.locales.additional.includes(query.locale))
          throw notFound("Enabled locale");
        return {
          locales: {
            ...config.locales,
            additional: config.locales.additional.filter(
              (code) => code !== query.locale,
            ),
          },
        };
      }),
    ),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSettings)
  .openapi(...updateSettings)
  .openapi(...enableLocale)
  .openapi(...updateLocaleChrome)
  .openapi(...disableLocale);
