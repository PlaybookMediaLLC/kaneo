import { eq } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import {
  parseBag,
  readSettingsKey,
  writeSettingsKey,
} from "../feedback/settings-json";
import { defineQuillsRoute } from "../framework/define-route";
import { resendInbound } from "../framework/signed";

// Support settings stored in the workspace settings row: office hours, routing, email auto-ack and
// the spam filter. Each is one JSON key (or the spam-filter column), read with defaults for unset values.
// The email channel status reads the instance's mail configuration instead.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
export const officeHoursSchema = z.object({
  enabled: z.boolean(),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(validZone, "Unknown IANA timezone"),
  intervals: z
    .array(
      z
        .object({
          day: z.number().int().min(0).max(6),
          start: z.string().regex(HHMM, "Time must be HH:MM (24-hour)"),
          end: z.string().regex(HHMM, "Time must be HH:MM (24-hour)"),
        })
        .refine((i) => i.start !== i.end, "Start and end must differ"),
    )
    .max(50),
  holidays: z
    .array(
      z.object({
        date: z.string().regex(DATE, "Date must be YYYY-MM-DD"),
        name: z.string().max(100).optional(),
        recurringAnnual: z.boolean().default(false),
      }),
    )
    .max(100)
    .default([]),
});
const OFFICE_HOURS_DEFAULT = {
  enabled: false,
  timezone: "UTC",
  intervals: [],
  holidays: [],
};

const getOfficeHours = defineQuillsRoute({
  method: "get",
  path: "/support/office-hours",
  operationId: "getQuillsOfficeHours",
  summary: "Get the workspace office hours",
  description:
    "enabled=false means always open. A stored schedule that no longer validates reads as the default.",
  action: "manage_settings",
  response: officeHoursSchema,
  responseDescription: "The office hours",
  handler: async ({ db }) => {
    const parsed = officeHoursSchema.safeParse(
      await readSettingsKey(db, "metadata", "officeHours"),
    );
    return parsed.success ? parsed.data : OFFICE_HOURS_DEFAULT;
  },
});

const setOfficeHours = defineQuillsRoute({
  method: "put",
  path: "/support/office-hours",
  operationId: "setQuillsOfficeHours",
  summary: "Set the workspace office hours",
  action: "manage_settings",
  body: officeHoursSchema,
  response: officeHoursSchema,
  responseDescription: "The office hours",
  event: ({ workspaceId }) => ({
    type: "settings.office_hours_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) =>
    writeSettingsKey(db, "metadata", "officeHours", () => ({
      enabled: body.enabled,
      timezone: body.timezone,
      intervals: body.intervals.map((i) => ({
        day: i.day,
        start: i.start,
        end: i.end,
      })),
      holidays: body.holidays.map((h) => ({
        date: h.date,
        ...(h.name !== undefined && { name: h.name }),
        recurringAnnual: h.recurringAnnual,
      })),
    })),
});

const routingSchema = z.object({
  enabled: z.boolean(),
  strategy: z.literal("auto_assign_active"),
});
const enabledIn = (stored: unknown) =>
  !!stored &&
  typeof stored === "object" &&
  (stored as { enabled?: unknown }).enabled === true;

const getRouting = defineQuillsRoute({
  method: "get",
  path: "/support/routing",
  operationId: "getQuillsConversationRouting",
  summary: "Get the conversation routing settings",
  action: "manage_settings",
  response: routingSchema,
  responseDescription: "The routing settings",
  handler: async ({ db }) => ({
    enabled: enabledIn(
      await readSettingsKey(db, "metadata", "conversationRouting"),
    ),
    strategy: "auto_assign_active" as const,
  }),
});

const setRouting = defineQuillsRoute({
  method: "put",
  path: "/support/routing",
  operationId: "setQuillsConversationRouting",
  summary: "Set the conversation routing settings",
  description: "Only auto-assignment to active teammates exists.",
  action: "manage_settings",
  body: routingSchema,
  response: routingSchema,
  responseDescription: "The routing settings",
  event: ({ workspaceId }) => ({
    type: "settings.conversation_routing_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) =>
    writeSettingsKey(db, "metadata", "conversationRouting", () => ({
      enabled: body.enabled,
      strategy: "auto_assign_active" as const,
    })),
});

const autoAckSchema = z.object({ enabled: z.boolean() });

const getAutoAck = defineQuillsRoute({
  method: "get",
  path: "/support/email-auto-ack",
  operationId: "getQuillsEmailAutoAck",
  summary: "Get the email auto-acknowledgement setting",
  action: "manage_settings",
  response: autoAckSchema,
  responseDescription: "The auto-acknowledgement setting",
  handler: async ({ db }) => ({
    enabled: enabledIn(await readSettingsKey(db, "metadata", "emailAutoAck")),
  }),
});

const setAutoAck = defineQuillsRoute({
  method: "put",
  path: "/support/email-auto-ack",
  operationId: "setQuillsEmailAutoAck",
  summary: "Set the email auto-acknowledgement setting",
  description:
    "Records the setting only. The API sends no auto-acknowledgement yet.",
  action: "manage_settings",
  body: autoAckSchema,
  response: autoAckSchema,
  responseDescription: "The auto-acknowledgement setting",
  event: ({ workspaceId }) => ({
    type: "settings.email_auto_ack_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) =>
    writeSettingsKey(db, "metadata", "emailAutoAck", () => ({
      enabled: body.enabled,
    })),
});

const MAX_TRUSTED = 500;
/** Lower case, trimmed, and an address or a domain (optionally `@domain`); anything else is dropped. */
const trusted = (raw: unknown) => {
  if (typeof raw !== "string") return null;
  const entry = raw.trim().toLowerCase();
  if (!entry || entry.length > 320 || /\s/.test(entry)) return null;
  const bare = entry.startsWith("@") ? entry.slice(1) : entry;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(bare) ||
    /^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare)
    ? entry
    : null;
};
const normalize = (entries: unknown[]) =>
  [
    ...new Set(entries.map(trusted).filter((e): e is string => e !== null)),
  ].slice(0, MAX_TRUSTED);
const spamSchema = z.object({
  trustedSenders: z.array(z.string()),
  aiClassifier: z.boolean(),
});
const readSpam = (text: string | null) => {
  const bag = parseBag(text) ?? {};
  return {
    trustedSenders: Array.isArray(bag.trustedSenders)
      ? normalize(bag.trustedSenders)
      : [],
    aiClassifier:
      typeof bag.aiClassifier === "boolean" ? bag.aiClassifier : true,
  };
};

const getSpam = defineQuillsRoute({
  method: "get",
  path: "/support/spam-filter",
  operationId: "getQuillsSpamFilterConfig",
  summary: "Get the spam filter settings",
  action: "manage_settings",
  response: spamSchema,
  responseDescription: "The spam filter settings",
  handler: async ({ db }) => {
    const [row] = await db
      .select({ text: settings.spamFilterConfig })
      .from(settings);
    return readSpam(row?.text ?? null);
  },
});

const setSpam = defineQuillsRoute({
  method: "patch",
  path: "/support/spam-filter",
  operationId: "updateQuillsSpamFilterConfig",
  summary: "Update the spam filter settings",
  description:
    "trustedSenders replaces the whole list (at most 500). Entries are lower-cased and an entry that is not an address or a domain is dropped.",
  action: "manage_settings",
  body: z
    .object({
      trustedSenders: z.array(z.string().max(320)).max(MAX_TRUSTED).optional(),
      aiClassifier: z.boolean().optional(),
    })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Send at least one field",
    ),
  response: spamSchema,
  responseDescription: "The spam filter settings",
  event: ({ workspaceId }) => ({
    type: "settings.spam_filter_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) => {
    const [row] = await db
      .select({ id: settings.id, text: settings.spamFilterConfig })
      .from(settings)
      .for("update");
    if (!row) throw new Error("Quills workspace was not initialized");
    const current = readSpam(row.text);
    const next = {
      trustedSenders: body.trustedSenders
        ? normalize(body.trustedSenders)
        : current.trustedSenders,
      aiClassifier: body.aiClassifier ?? current.aiClassifier,
    };
    await db
      .update(settings)
      .set({ spamFilterConfig: JSON.stringify(next) })
      .where(eq(settings.id, row.id));
    return next;
  },
});

const set = (name: string) => Boolean(process.env[name]?.trim());

/**
 * The outbound mail provider, by the rules of `@kaneo/email/quills/provider#resolveEmailProvider`
 * (a route module may not import the mail package). Null when more than one is configured: the
 * mail worker then refuses to send. support-settings.test.ts checks both against each other.
 */
export function outboundProvider():
  | "ses"
  | "smtp"
  | "resend"
  | "console"
  | null {
  const found: ("ses" | "smtp" | "resend")[] = [];
  if (set("EMAIL_SES_ACCESS_KEY_ID") && set("EMAIL_SES_SECRET_ACCESS_KEY"))
    found.push("ses");
  if (set("EMAIL_SMTP_HOST")) found.push("smtp");
  const inboundOnly =
    process.env.EMAIL_INBOUND_PROVIDER?.trim().toLowerCase() === "resend";
  if (
    (set("EMAIL_RESEND_API_KEY") || set("RESEND_API_KEY")) &&
    !(inboundOnly && found.length)
  )
    found.push("resend");
  if (found.length > 1) return null;
  return found[0] ?? "console";
}

const emailStatus = defineQuillsRoute({
  method: "get",
  path: "/support/email-channel/status",
  operationId: "getQuillsEmailChannelStatus",
  summary: "Get the status of the instance's email transport",
  description:
    "Names only, never a credential. provider is the outbound provider (console: none, mail is only logged), or null when more than one is configured. inboundConfigured is true when the inbound mail route accepts deliveries.",
  action: "manage_settings",
  response: z.object({
    provider: z.enum(["ses", "smtp", "resend", "console"]).nullable(),
    fromAddress: z.string().nullable(),
    inboundConfigured: z.boolean(),
    inboundDomain: z.string().nullable(),
  }),
  responseDescription: "The email transport status",
  handler: async () => ({
    provider: outboundProvider(),
    fromAddress: process.env.EMAIL_FROM?.trim() || null,
    inboundConfigured: !resendInbound.disabled?.(),
    inboundDomain:
      process.env.EMAIL_INBOUND_DOMAIN?.trim().toLowerCase() || null,
  }),
});

/** Teammate routes for support settings. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getOfficeHours)
  .openapi(...setOfficeHours)
  .openapi(...getRouting)
  .openapi(...setRouting)
  .openapi(...getAutoAck)
  .openapi(...setAutoAck)
  .openapi(...getSpam)
  .openapi(...setSpam)
  .openapi(...emailStatus);
