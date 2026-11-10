import { eq, isNull, sql } from "drizzle-orm";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import {
  bool,
  defined,
  parseJson,
  record,
  settingsArea,
  str,
  type SettingsRow,
} from "./area";

// Widget configuration and its signing secret. The secret is returned only by the
// secret routes below, never by the configuration read. Messenger settings and
// translations are kept as stored; they belong to the messenger area.

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const tabKeys = [
  "feedback",
  "changelog",
  "help",
  "messenger",
  "tickets",
  "home",
] as const;
const hex = z.union([z.literal(""), z.string().regex(/^#[0-9a-f]{6}$/i)]);
const card = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum([
      "feedback",
      "new_conversation",
      "article_search",
      "latest_updates",
      "link",
    ]),
    enabled: z.boolean().optional(),
    audience: z.enum(["everyone", "anonymous", "identified"]).optional(),
    title: z.string().max(80).optional(),
    subtitle: z.string().max(160).optional(),
    url: z
      .string()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)")
      .optional(),
  })
  .refine((c) => c.type !== "link" || Boolean(c.url), "Link cards need a URL");
const home = z.object({
  greeting: z.string().max(120).optional(),
  subtitle: z.string().max(200).optional(),
  headerStyle: z.enum(["plain", "gradient", "pattern", "image"]).optional(),
  gradient: z.object({ from: hex.optional(), to: hex.optional() }).optional(),
  pattern: z.enum(["dots", "grid", "mesh", "waves"]).optional(),
  showLogo: z.boolean().optional(),
  showTeamAvatars: z.boolean().optional(),
  cards: z.array(card).max(8).optional(),
});
const tabs = z.object(
  Object.fromEntries(tabKeys.map((key) => [key, z.boolean()])) as {
    [K in (typeof tabKeys)[number]]: z.ZodBoolean;
  },
);

const config = z.object({
  enabled: z.boolean(),
  defaultBoard: z.string().nullable(),
  position: z.string(),
  launcherGreeting: z.string(),
  launcherLabel: z.string(),
  tabs,
  visitorAnalytics: z.boolean(),
  visitorDeviceTracking: z.boolean(),
  home: z.object({
    greeting: z.string().nullable(),
    subtitle: z.string().nullable(),
    headerStyle: z.string(),
    gradientFrom: z.string().nullable(),
    gradientTo: z.string().nullable(),
    pattern: z.string(),
    showLogo: z.boolean(),
    showTeamAvatars: z.boolean(),
    cards: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        enabled: z.boolean(),
        audience: z.string(),
        title: z.string().nullable(),
        subtitle: z.string().nullable(),
        url: z.string().nullable(),
      }),
    ),
  }),
});

function readConfig(row: SettingsRow) {
  const stored = parseJson(row.widgetConfig);
  // An empty blob takes today's defaults; an older stored blob keeps the older tab defaults.
  const fresh = Object.keys(stored).length === 0;
  const storedTabs = record(stored.tabs);
  const storedHome = record(stored.home);
  const gradient = record(storedHome.gradient);
  return {
    enabled: bool(stored.enabled, false),
    defaultBoard: str(stored.defaultBoard) ?? null,
    position: str(stored.position) ?? "bottom-right",
    launcherGreeting: str(stored.launcherGreeting) ?? "",
    launcherLabel: str(stored.launcherLabel) ?? "",
    tabs: {
      feedback: bool(storedTabs.feedback, true),
      changelog: bool(storedTabs.changelog, fresh),
      help: bool(storedTabs.help, false),
      messenger: bool(storedTabs.messenger, fresh),
      tickets: bool(storedTabs.tickets, true),
      home: bool(storedTabs.home, true),
    },
    visitorAnalytics: bool(stored.visitorAnalytics, true),
    visitorDeviceTracking: bool(stored.visitorDeviceTracking, true),
    home: {
      greeting: str(storedHome.greeting) ?? null,
      subtitle: str(storedHome.subtitle) ?? null,
      headerStyle: str(storedHome.headerStyle) ?? "plain",
      gradientFrom: str(gradient.from) ?? null,
      gradientTo: str(gradient.to) ?? null,
      pattern: str(storedHome.pattern) ?? "mesh",
      showLogo: bool(storedHome.showLogo, true),
      showTeamAvatars: bool(storedHome.showTeamAvatars, true),
      cards: (Array.isArray(storedHome.cards) ? storedHome.cards : []).flatMap(
        (value: unknown) => {
          const item = record(value);
          return typeof item.id === "string" && typeof item.type === "string"
            ? [
                {
                  id: item.id,
                  type: item.type,
                  enabled: bool(item.enabled, true),
                  audience: str(item.audience) ?? "everyone",
                  title: str(item.title) ?? null,
                  subtitle: str(item.subtitle) ?? null,
                  url: str(item.url) ?? null,
                },
              ]
            : [];
        },
      ),
    },
  };
}

const area = settingsArea({
  name: "widget",
  title: "Widget",
  label: "widget",
  response: config,
  read: readConfig,
  patch: z.object({
    enabled: z.boolean().optional(),
    defaultBoard: z.string().max(200).optional(),
    position: z.enum(["bottom-right", "bottom-left"]).optional(),
    launcherGreeting: z.string().max(120).optional(),
    launcherLabel: z.string().max(60).optional(),
    visitorAnalytics: z.boolean().optional(),
    visitorDeviceTracking: z.boolean().optional(),
    tabs: tabs.partial().optional(),
    /** Merged into the stored Home settings; the hero image key is never written here. */
    home: home.optional(),
  }),
  apply: (row, patch) => {
    const stored = parseJson(row.widgetConfig);
    const storedHome = record(stored.home);
    return {
      widgetConfig: JSON.stringify({
        ...stored,
        ...defined({
          enabled: patch.enabled,
          defaultBoard: patch.defaultBoard,
          position: patch.position,
          launcherGreeting: patch.launcherGreeting,
          launcherLabel: patch.launcherLabel,
          visitorAnalytics: patch.visitorAnalytics,
          visitorDeviceTracking: patch.visitorDeviceTracking,
        }),
        ...(patch.tabs && {
          tabs: { ...record(stored.tabs), ...defined(patch.tabs) },
        }),
        ...(patch.home && {
          home: {
            ...storedHome,
            ...defined({
              greeting: patch.home.greeting,
              subtitle: patch.home.subtitle,
              headerStyle: patch.home.headerStyle,
              pattern: patch.home.pattern,
              showLogo: patch.home.showLogo,
              showTeamAvatars: patch.home.showTeamAvatars,
              cards: patch.home.cards,
            }),
            ...(patch.home.gradient && {
              gradient: {
                ...record(storedHome.gradient),
                ...defined(patch.home.gradient),
              },
            }),
          },
        }),
      }),
    };
  },
});

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const newSecret = () => `wgt_${randomHex(32)}`;
const secretResponse = z.object({ secret: z.string().nullable() });

async function lockedSettings(db: Db) {
  const [row] = await db
    .select({ id: settings.id, widgetSecret: settings.widgetSecret })
    .from(settings)
    .limit(1)
    .for("update");
  if (!row) throw new Error("Quills settings were not initialized");
  return row;
}

const getSecret = defineQuillsRoute({
  method: "get",
  path: "/settings/widget/secret",
  operationId: "getQuillsWidgetSecret",
  summary: "Get the widget signing secret",
  description:
    "Null until the secret is created with the rotate route. Requires quills:manage_settings.",
  action: "manage_settings",
  response: secretResponse,
  responseDescription: "The widget signing secret",
  allowKeys: ["secret"],
  handler: async ({ db }) => {
    const [row] = await db
      .select({ secret: settings.widgetSecret })
      .from(settings)
      .limit(1);
    return { secret: row?.secret ?? null };
  },
});

const rotateSecret = defineQuillsRoute({
  method: "post",
  path: "/settings/widget/secret",
  operationId: "rotateQuillsWidgetSecret",
  summary: "Create or replace the widget signing secret",
  description: "The old secret stops working at once.",
  action: "manage_settings",
  response: z.object({ secret: z.string() }),
  responseDescription: "The new widget signing secret",
  allowKeys: ["secret"],
  event: ({ workspaceId }) => ({
    type: "settings.widget_secret_rotated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db }) => {
    const row = await lockedSettings(db);
    const secret = newSecret();
    await db
      .update(settings)
      .set({ widgetSecret: secret })
      .where(eq(settings.id, row.id));
    return { secret };
  },
});

const CODE_TTL_SECONDS = 15 * 60;

const mintInstallCode = defineQuillsRoute({
  method: "post",
  path: "/settings/widget/install-code",
  operationId: "mintQuillsWidgetInstallCode",
  summary: "Create a short-lived widget install pairing code",
  description:
    "The code, not the signing secret, goes into an install prompt. It is stored hashed, expires after 15 minutes and can be redeemed twice. Creates the signing secret when it is missing.",
  action: "manage_settings",
  response: z.object({ code: z.string(), expiresAt: responseTimestamp }),
  responseDescription: "The pairing code",
  event: ({ workspaceId }) => ({
    type: "settings.widget_install_code_minted",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db }) => {
    const row = await lockedSettings(db);
    if (!row.widgetSecret)
      await db
        .update(settings)
        .set({ widgetSecret: newSecret() })
        .where(isNull(settings.widgetSecret));
    const code = `qbi_${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    await db.insert(kvStore).values({
      workspaceKey: "_",
      key: sql`'widget:install-pairing:' || encode(sha256(convert_to(${code}, 'UTF8')), 'hex')`,
      value: { remaining: 2 },
      expiresAt,
    });
    return { code, expiresAt };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", area)
  .openapi(...getSecret)
  .openapi(...rotateSecret)
  .openapi(...mintInstallCode);
