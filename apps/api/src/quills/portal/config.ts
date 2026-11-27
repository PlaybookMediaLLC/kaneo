import { aiConfig } from "../assistant/provider";
import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { imageUrl } from "../framework/files";
import { bool, parseJson, record, str } from "../settings/area";
import { requirePortal } from "./feedback/viewer";
import { navLinks, navTabs } from "./nav";

// The portal configuration that anyone may read. The access policy (allowed domains and
// segments) stays server-side; only "is the portal private" leaves.

const colorKeys = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "accentInk",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
  "success",
  "sidebarBackground",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "sidebarRing",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
] as const;

const colorSchema = z.object(
  Object.fromEntries(colorKeys.map((key) => [key, z.string().optional()])) as {
    [K in (typeof colorKeys)[number]]: z.ZodOptional<z.ZodString>;
  },
);

const publicColors = (value: unknown) =>
  Object.fromEntries(
    colorKeys.flatMap((key) => {
      const color = str(record(value)[key])?.trim();
      return !color || /url\s*\(|@import/i.test(color) ? [] : [[key, color]];
    }),
  );

export const publicBranding = (value: string | null) => {
  const stored = parseJson(value);
  return {
    themeMode:
      stored.themeMode === "light" || stored.themeMode === "dark"
        ? (stored.themeMode as "light" | "dark")
        : ("user" as const),
    light: publicColors(stored.light),
    dark: publicColors(stored.dark),
  };
};

const safeLogoUrl = async (key: string | null) => {
  const value = key && (await imageUrl(key));
  if (!value) return null;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
};

const portalConfig = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/portal/config",
  operationId: "getQuillsPublicPortalConfig",
  summary: "Get the public portal configuration",
  description:
    "Sign-in uses the existing Kaneo account endpoints under /api/auth; portal customers need no workspace membership.",
  action: "read",
  // Short private cache so signed S3 logo URLs (default 300s TTL) are never cached in shared CDNs.
  cacheControl: "private, max-age=60",
  response: z.object({
    name: z.string(),
    features: z.object({
      allowAnonymous: z.boolean(),
      allowEditAfterEngagement: z.boolean(),
      allowDeleteAfterEngagement: z.boolean(),
      showPublicEditHistory: z.boolean(),
      ai: z.boolean().openapi({
        description:
          "The instance has an AI provider, so the portal can offer AI help and translation",
      }),
    }),
    portalAccess: z.object({ isPrivate: z.boolean() }),
    nav: z.object({
      tabs: z
        .object({
          feedback: z.boolean(),
          roadmap: z.boolean(),
          changelog: z.boolean(),
          help: z.boolean(),
          support: z.boolean(),
          status: z.boolean(),
        })
        .openapi({
          description:
            "The built-in portal tabs that are on. A tab that the stored tab list does not name is on. While the roadmap or changelog tab is off, its customer routes answer 404.",
        }),
      links: z
        .array(
          z.object({
            label: z.string().max(30),
            url: z.string().max(2048),
            newTab: z.boolean(),
          }),
        )
        .max(20)
        .openapi({
          description:
            "The custom link tabs that are on, in stored order. Only http(s) URLs with a label.",
        }),
    }),
    branding: z.object({
      logoUrl: z.string().nullable(),
      theme: z.object({
        themeMode: z.enum(["light", "dark", "user"]),
        light: colorSchema,
        dark: colorSchema,
      }),
      headerDisplayMode: z.enum(["logo_and_name", "logo_only", "custom_logo"]),
      headerDisplayName: z.string().nullable(),
    }),
  }),
  responseDescription: "The public portal configuration",
  handler: async ({ db }) => {
    const config = await requirePortal(db);
    const [row] = await db
      .select({
        name: settings.name,
        logoKey: settings.logoKey,
        brandingConfig: settings.brandingConfig,
        headerDisplayMode: settings.headerDisplayMode,
        headerDisplayName: settings.headerDisplayName,
      })
      .from(settings)
      .limit(1);
    const features = record(config.features);
    return {
      name: row?.name ?? "",
      features: {
        // A missing flag denies anonymous interaction.
        allowAnonymous: features.allowAnonymous === true,
        allowEditAfterEngagement: bool(
          features.allowEditAfterEngagement,
          false,
        ),
        allowDeleteAfterEngagement: bool(
          features.allowDeleteAfterEngagement,
          false,
        ),
        showPublicEditHistory: bool(features.showPublicEditHistory, false),
        ai: aiConfig() !== null,
      },
      portalAccess: {
        isPrivate: record(config.access).visibility === "private",
      },
      nav: { tabs: navTabs(config), links: navLinks(config) },
      branding: {
        logoUrl: await safeLogoUrl(row?.logoKey ?? null),
        theme: publicBranding(row?.brandingConfig ?? null),
        headerDisplayMode:
          row?.headerDisplayMode === "logo_only" ||
          row?.headerDisplayMode === "custom_logo"
            ? (row.headerDisplayMode as "logo_only" | "custom_logo")
            : ("logo_and_name" as const),
        headerDisplayName: row?.headerDisplayName ?? null,
      },
    };
  },
});

export default apiRouter().openapi(...portalConfig);
