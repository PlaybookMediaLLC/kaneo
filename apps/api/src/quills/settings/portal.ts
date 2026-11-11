import { z } from "../../openapi";
import { bool, parseJson, record, settingsArea, str } from "./area";

// Routes come from settingsArea, which declares them with ../framework/define-route.
// Writable fields match Quackback's updatePortalConfigFn. Access, moderation and the
// welcome card have their own writers in later phases; this area only reads them.

const navTypes = [
  "feedback",
  "roadmap",
  "changelog",
  "help",
  "support",
  "status",
  "link",
] as const;
const navItem = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(navTypes),
  enabled: z.boolean().optional(),
  label: z.string().trim().max(30).optional(),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)")
    .optional(),
  newTab: z.boolean().optional(),
});
const navOut = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  label: z.string().nullable(),
  url: z.string().nullable(),
  newTab: z.boolean(),
});

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

export default settingsArea({
  name: "portal",
  title: "Portal",
  label: "portal",
  response: z.object({
    /** Portals are opt-in: every portal and public route is 404 until a teammate turns this on. */
    enabled: z.boolean(),
    features: z.object({
      allowAnonymous: z.boolean(),
      allowEditAfterEngagement: z.boolean(),
      allowDeleteAfterEngagement: z.boolean(),
      showPublicEditHistory: z.boolean(),
    }),
    openSignup: z.boolean().nullable(),
    moderationDefault: z.object({
      requireApproval: z.string(),
      holdImages: z.boolean(),
      holdLinks: z.boolean(),
    }),
    access: z.object({
      visibility: z.string(),
      allowedDomains: z.array(z.string()),
      widgetSignIn: z.boolean(),
      allowedSegmentIds: z.array(z.string()),
    }),
    nav: z.array(navOut),
    supportEnabled: z.boolean(),
  }),
  read: (row) => {
    const config = parseJson(row.portalConfig);
    const features = record(config.features);
    const moderation = record(config.moderationDefault);
    const access = record(config.access);
    return {
      enabled: config.enabled === true,
      features: {
        // A missing flag denies anonymous interaction, as the portal gate does.
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
      },
      openSignup:
        typeof config.openSignup === "boolean" ? config.openSignup : null,
      moderationDefault: {
        requireApproval: str(moderation.requireApproval) ?? "none",
        holdImages: bool(moderation.holdImages, false),
        holdLinks: bool(moderation.holdLinks, false),
      },
      access: {
        visibility: access.visibility === "private" ? "private" : "public",
        allowedDomains: strings(access.allowedDomains),
        widgetSignIn: bool(access.widgetSignIn, false),
        allowedSegmentIds: strings(access.allowedSegmentIds),
      },
      nav: (Array.isArray(record(config.nav).items)
        ? (record(config.nav).items as unknown[])
        : []
      ).flatMap((value) => {
        const item = record(value);
        return typeof item.id === "string" && typeof item.type === "string"
          ? [
              {
                id: item.id,
                type: item.type,
                enabled: bool(item.enabled, true),
                label: str(item.label) ?? null,
                url: str(item.url) ?? null,
                newTab: bool(item.newTab, true),
              },
            ]
          : [];
      }),
      supportEnabled: bool(record(config.support).enabled, true),
    };
  },
  patch: z.object({
    enabled: z.boolean().optional(),
    allowAnonymous: z.boolean().optional(),
    openSignup: z.boolean().optional(),
    supportEnabled: z.boolean().optional(),
    /** The ordered top-nav, saved whole. */
    nav: z.array(navItem).max(20).optional(),
  }),
  apply: (row, patch) => {
    const config = parseJson(row.portalConfig);
    return {
      portalConfig: JSON.stringify({
        ...config,
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.allowAnonymous !== undefined && {
          features: {
            ...record(config.features),
            allowAnonymous: patch.allowAnonymous,
          },
        }),
        ...(patch.openSignup !== undefined && { openSignup: patch.openSignup }),
        ...(patch.supportEnabled !== undefined && {
          support: { ...record(config.support), enabled: patch.supportEnabled },
        }),
        ...(patch.nav && {
          nav: {
            items: patch.nav.map((item) => ({
              id: item.id,
              type: item.type,
              enabled: item.enabled,
              label: item.label,
              url: item.type === "link" ? item.url : undefined,
              newTab: item.type === "link" ? item.newTab : undefined,
            })),
          },
        }),
      }),
    };
  },
});
