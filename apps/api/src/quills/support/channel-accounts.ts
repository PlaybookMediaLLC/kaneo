import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  channelAccounts,
  emailSendingDomains,
} from "../../database/quills/schema/channel-accounts";
import { emailLog } from "../../database/quills/schema/email-log";
import { teams } from "../../database/quills/schema/teams";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { notFound } from "./ticket-view";

// Email channel configuration only: no mail is sent, no DNS is queried and no provider identity is
// created in a request. Credentials and signing keys are never returned.

type Account = typeof channelAccounts.$inferSelect;
type Domain = typeof emailSendingDomains.$inferSelect;
const errors = {
  404: "Sending address or sending domain not found",
  409: "No default team owns email, or the address or domain is in use",
};
const accountSchema = z.object({
  id: z.string(),
  role: z.enum(channelAccounts.role.enumValues),
  address: z.string().nullable(),
  module: z.enum(["support", "feedback", "changelog"]).nullable(),
  inboundTrust: z.enum(["strict", "lenient"]),
  forwardingTarget: z.string().nullable(),
  smtp: z
    .object({ host: z.string(), port: z.number(), secure: z.boolean() })
    .nullable(),
  sendingDomainId: z.string().nullable(),
  sendingDomain: z
    .object({ domain: z.string(), status: z.string() })
    .nullable(),
  createdAt: responseTimestamp,
});
const domainSchema = z.object({
  id: z.string(),
  domain: z.string(),
  status: z.enum(["pending", "verified", "failed"]),
  dnsRecords: z.array(
    z.object({
      type: z.string(),
      host: z.string(),
      value: z.string(),
      purpose: z.string(),
      priority: z.number().optional(),
    }),
  ),
  verifiedAt: nullableResponseTimestamp,
  mailFromLabel: z.string(),
  dkimMode: z.enum(["easy", "byo", "shared"]),
  signingKeyPending: z.boolean(),
  autoCheckUntil: nullableResponseTimestamp,
  lastCheckedAt: nullableResponseTimestamp,
});
const live = isNull(channelAccounts.deletedAt);

const accountView = (a: Account, domains: Domain[] = []) => {
  const domain = domains.find((d) => d.id === a.sendingDomainId);
  const smtp = a.config.smtp;
  return {
    id: a.id,
    role: a.role,
    address: a.address,
    module: a.module,
    inboundTrust: a.inboundTrust,
    forwardingTarget: a.config.forwardingTarget ?? null,
    smtp: smtp
      ? { host: smtp.host, port: smtp.port, secure: smtp.secure }
      : null,
    sendingDomainId: a.sendingDomainId,
    sendingDomain: domain
      ? { domain: domain.domain, status: domain.status }
      : null,
    createdAt: a.createdAt,
  };
};
const domainView = (d: Domain) => ({
  id: d.id,
  domain: d.domain,
  status: d.status,
  dnsRecords: d.dnsRecords.map((r) => ({
    type: r.type,
    host: r.host,
    value: r.value,
    purpose: r.purpose,
    ...("priority" in r && { priority: r.priority }),
  })),
  verifiedAt: d.verifiedAt,
  mailFromLabel: d.mailFromLabel,
  dkimMode: d.dkimMode,
  signingKeyPending: d.pendingSigningKey != null,
  autoCheckUntil: d.autoCheckUntil,
  lastCheckedAt: d.lastCheckedAt,
});

/** The workspace's default team owns its email configuration. */
async function defaultTeam(db: Database) {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)));
  if (!team)
    throw new HTTPException(409, {
      message: "No default team is configured for email.",
    });
  return team.id;
}

async function inboundRoute(db: Database, teamId: TypeId<"team">) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.owningTeamId, teamId),
        eq(channelAccounts.role, "inbound"),
        eq(channelAccounts.channel, "email"),
        live,
      ),
    )
    .for("update");
  return row ?? null;
}

/** Updates the inbound route, or creates it with the change when there is none. */
async function saveInbound(
  db: Database,
  change: (row: Account | null) => Pick<Account, "config" | "inboundTrust">,
) {
  const teamId = await defaultTeam(db);
  const existing = await inboundRoute(db, teamId);
  const next = change(existing);
  const [row] = existing
    ? await db
        .update(channelAccounts)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(channelAccounts.id, existing.id))
        .returning()
    : await db
        .insert(channelAccounts)
        .values({ owningTeamId: teamId, role: "inbound", ...next })
        .onConflictDoNothing()
        .returning();
  // A concurrent first save created the route (channel_accounts_one_inbound_uq).
  if (!row)
    throw new HTTPException(409, {
      message: "The inbound route is being created",
    });
  return accountView(row);
}

async function findSendingAddress(db: Database, id: TypeId<"channel_account">) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, id),
        eq(channelAccounts.role, "sending"),
        live,
      ),
    )
    .for("update");
  if (!row) throw notFound("Sending address");
  return row;
}

async function findDomain(db: Database, id: TypeId<"sending_domain">) {
  const [row] = await db
    .select()
    .from(emailSendingDomains)
    .where(eq(emailSendingDomains.id, id))
    .for("update");
  if (!row) throw notFound("Sending domain");
  return row;
}

const inboundEvent = (_input: unknown, account: { id: string }) => ({
  type: "channel_account.inbound_updated" as const,
  entityType: "channel_account" as const,
  entityId: account.id,
});

const getConfig = defineQuillsRoute({
  method: "get",
  path: "/support/email-channel",
  operationId: "getQuillsEmailChannelConfig",
  summary: "Get the email channel configuration",
  description:
    "The default team's inbound route, sending addresses and sending domains. Empty when no default team exists.",
  action: "manage_settings",
  response: z.object({
    inboundRoute: accountSchema.nullable(),
    sendingAddresses: z.array(accountSchema),
    domains: z.array(domainSchema),
  }),
  responseDescription: "The email channel configuration",
  handler: async ({ db }) => {
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)));
    if (!team) return { inboundRoute: null, sendingAddresses: [], domains: [] };
    const domains = await db
      .select()
      .from(emailSendingDomains)
      .where(eq(emailSendingDomains.owningTeamId, team.id))
      .orderBy(desc(emailSendingDomains.createdAt))
      .limit(100);
    const accounts = await db
      .select()
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.owningTeamId, team.id),
          eq(channelAccounts.channel, "email"),
          inArray(channelAccounts.role, ["inbound", "sending"]),
          live,
        ),
      )
      .orderBy(desc(channelAccounts.createdAt))
      .limit(200);
    const inbound = accounts.find((a) => a.role === "inbound");
    return {
      inboundRoute: inbound ? accountView(inbound, domains) : null,
      sendingAddresses: accounts
        .filter((a) => a.role === "sending")
        .map((a) => accountView(a, domains)),
      domains: domains.map(domainView),
    };
  },
});

const setForwarding = defineQuillsRoute({
  method: "put",
  path: "/support/email-channel/inbound",
  operationId: "setQuillsInboundForwarding",
  summary: "Set the inbound route's forwarding address",
  description: "Creates the inbound route when it does not exist.",
  action: "manage_settings",
  body: z.object({
    forwardingTarget: z.string().trim().toLowerCase().email().max(320),
  }),
  response: accountSchema,
  responseDescription: "The inbound route",
  errors,
  event: inboundEvent,
  handler: async ({ db, body }) =>
    saveInbound(db, (row) => ({
      config: { ...row?.config, forwardingTarget: body.forwardingTarget },
      inboundTrust: row?.inboundTrust ?? "strict",
    })),
});

const clearForwarding = defineQuillsRoute({
  method: "delete",
  path: "/support/email-channel/inbound/forwarding",
  operationId: "clearQuillsInboundForwarding",
  summary: "Remove the inbound route's forwarding address",
  description:
    "The workspace's own inbox address stays. Null when there is no inbound route.",
  action: "manage_settings",
  response: accountSchema.nullable(),
  responseDescription: "The inbound route",
  errors,
  event: (input, account) => account !== null && inboundEvent(input, account),
  handler: async ({ db }) => {
    const teamId = await defaultTeam(db);
    const existing = await inboundRoute(db, teamId);
    if (!existing) return null;
    const { forwardingTarget: _dropped, ...config } = existing.config;
    const [row] = await db
      .update(channelAccounts)
      .set({ config, updatedAt: new Date() })
      .where(eq(channelAccounts.id, existing.id))
      .returning();
    return accountView(row!);
  },
});

const setTrust = defineQuillsRoute({
  method: "put",
  path: "/support/email-channel/inbound/trust",
  operationId: "setQuillsInboundTrust",
  summary: "Set the inbound route's sender trust",
  description: "Creates the inbound route when it does not exist.",
  action: "manage_settings",
  body: z.object({ inboundTrust: z.enum(["strict", "lenient"]) }),
  response: accountSchema,
  responseDescription: "The inbound route",
  errors,
  event: inboundEvent,
  handler: async ({ db, body }) =>
    saveInbound(db, (row) => ({
      config: row?.config ?? {},
      inboundTrust: body.inboundTrust,
    })),
});

const addAddress = defineQuillsRoute({
  method: "post",
  path: "/support/email-channel/sending-addresses",
  operationId: "createQuillsSendingAddress",
  summary: "Add or move a sending address",
  description:
    "Adding an address again moves it to the new module. Its domain is recorded as a pending sending domain when it is new; Kaneo does not yet create provider identities or check DNS for it.",
  action: "manage_settings",
  body: z.object({
    address: z.string().trim().toLowerCase().email().max(320),
    module: z.enum(["support", "feedback", "changelog"]),
  }),
  response: accountSchema,
  responseDescription: "The sending address",
  errors,
  event: (_input, account) => ({
    type: "channel_account.sending_address_saved",
    entityType: "channel_account",
    entityId: account.id,
    payload: { module: account.module ?? "" },
  }),
  handler: async ({ db, body }) => {
    const teamId = await defaultTeam(db);
    const domainName = body.address.slice(body.address.lastIndexOf("@") + 1);
    let [domain] = await db
      .select()
      .from(emailSendingDomains)
      .where(
        and(
          eq(emailSendingDomains.owningTeamId, teamId),
          eq(emailSendingDomains.domain, domainName),
        ),
      );
    domain ??= (
      await db
        .insert(emailSendingDomains)
        .values({ owningTeamId: teamId, domain: domainName })
        .onConflictDoNothing()
        .returning()
    )[0];
    if (!domain)
      throw new HTTPException(409, {
        message: "The sending domain is being added",
      });
    const [existing] = await db
      .select()
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.owningTeamId, teamId),
          eq(channelAccounts.channel, "email"),
          eq(channelAccounts.address, body.address),
          live,
        ),
      )
      .for("update");
    if (existing && existing.role !== "sending")
      throw new HTTPException(409, {
        message: `${body.address} is already in use by this workspace's inbound route.`,
      });
    const [row] = existing
      ? await db
          .update(channelAccounts)
          .set({
            module: body.module,
            sendingDomainId: domain.id,
            updatedAt: new Date(),
          })
          .where(eq(channelAccounts.id, existing.id))
          .returning()
      : await db
          .insert(channelAccounts)
          .values({
            owningTeamId: teamId,
            role: "sending",
            address: body.address,
            module: body.module,
            sendingDomainId: domain.id,
          })
          .onConflictDoNothing()
          .returning();
    if (!row)
      throw new HTTPException(409, { message: "The address is being added" });
    return accountView(row, [domain]);
  },
});

const addressParams = z.object({
  channelAccountId: flexibleToTypeIdSchema("channel_account"),
});

const setSmtp = defineQuillsRoute({
  method: "put",
  path: "/support/email-channel/sending-addresses/{channelAccountId}/smtp",
  operationId: "setQuillsSendingAddressSmtp",
  summary: "Set or clear a sending address's SMTP override",
  description:
    "null clears the override. The SMTP user is stored but never returned.",
  action: "manage_settings",
  params: addressParams,
  body: z.object({
    smtp: z
      .object({
        host: z.string().min(1).max(255),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().min(1).max(255),
      })
      .nullable(),
  }),
  response: accountSchema,
  responseDescription: "The sending address",
  errors,
  event: ({ params }) => ({
    type: "channel_account.smtp_updated",
    entityType: "channel_account",
    entityId: params.channelAccountId,
  }),
  handler: async ({ db, params, body }) => {
    const existing = await findSendingAddress(db, params.channelAccountId);
    const { smtp: _old, ...rest } = existing.config;
    const config = body.smtp
      ? {
          ...rest,
          smtp: {
            host: body.smtp.host,
            port: body.smtp.port,
            secure: body.smtp.secure,
            user: body.smtp.user,
          },
        }
      : rest;
    const [row] = await db
      .update(channelAccounts)
      .set({ config, updatedAt: new Date() })
      .where(eq(channelAccounts.id, existing.id))
      .returning();
    return accountView(row!);
  },
});

const removeAddress = defineQuillsRoute({
  method: "delete",
  path: "/support/email-channel/sending-addresses/{channelAccountId}",
  operationId: "deleteQuillsChannelAccount",
  summary: "Remove a sending address",
  description:
    "lastOnDomain names the domain when no live sending address uses it any more.",
  action: "manage_settings",
  params: addressParams,
  response: z.object({
    id: z.string(),
    lastOnDomain: z.object({ id: z.string(), domain: z.string() }).nullable(),
  }),
  responseDescription: "The removed address",
  errors,
  event: ({ params }) => ({
    type: "channel_account.deleted",
    entityType: "channel_account",
    entityId: params.channelAccountId,
  }),
  handler: async ({ db, params }) => {
    const account = await findSendingAddress(db, params.channelAccountId);
    const now = new Date();
    await db
      .update(channelAccounts)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(channelAccounts.id, account.id));
    if (!account.sendingDomainId) return { id: account.id, lastOnDomain: null };
    const domain = await findDomain(db, account.sendingDomainId);
    const [other] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.role, "sending"),
          live,
          or(
            eq(channelAccounts.sendingDomainId, domain.id),
            like(
              channelAccounts.address,
              `%@${domain.domain.replace(/[\\%_]/g, "\\$&")}`,
            ),
          ),
        ),
      )
      .limit(1);
    return {
      id: account.id,
      lastOnDomain: other ? null : { id: domain.id, domain: domain.domain },
    };
  },
});

const domainParams = z.object({
  sendingDomainId: flexibleToTypeIdSchema("sending_domain"),
});

const removeDomain = defineQuillsRoute({
  method: "delete",
  path: "/support/email-channel/domains/{sendingDomainId}",
  operationId: "deleteQuillsSendingDomain",
  summary: "Remove a sending domain",
  description: "Refused (409) while a live sending address uses it.",
  action: "manage_settings",
  params: domainParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The removed domain",
  errors,
  event: ({ params }) => ({
    type: "sending_domain.deleted",
    entityType: "sending_domain",
    entityId: params.sendingDomainId,
  }),
  handler: async ({ db, params }) => {
    const domain = await findDomain(db, params.sendingDomainId);
    const linked = eq(channelAccounts.sendingDomainId, domain.id);
    const [inUse] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(and(linked, live))
      .limit(1);
    if (inUse)
      throw new HTTPException(409, {
        message: "A sending address still uses this domain",
      });
    // A removed address keeps its link, and the foreign key restricts the delete, so the link goes first.
    await db
      .update(channelAccounts)
      .set({ sendingDomainId: null })
      .where(and(linked, isNotNull(channelAccounts.deletedAt)));
    await db
      .delete(emailSendingDomains)
      .where(eq(emailSendingDomains.id, domain.id));
    return { id: domain.id };
  },
});

const restartChecks = defineQuillsRoute({
  method: "post",
  path: "/support/email-channel/domains/{sendingDomainId}/checks",
  operationId: "restartQuillsSendingDomainChecks",
  summary: "Ask for a sending domain's checks to run again",
  description:
    "Opens a new 72-hour automatic check window and records the request. No DNS lookup runs in the request.",
  action: "manage_settings",
  params: domainParams,
  response: domainSchema,
  responseDescription: "The sending domain",
  errors,
  event: ({ params }) => ({
    type: "sending_domain.checks_restarted",
    entityType: "sending_domain",
    entityId: params.sendingDomainId,
  }),
  handler: async ({ db, params }) => {
    const domain = await findDomain(db, params.sendingDomainId);
    const [row] = await db
      .update(emailSendingDomains)
      .set({
        autoCheckUntil: new Date(Date.now() + 72 * 3600000),
        updatedAt: new Date(),
      })
      .where(eq(emailSendingDomains.id, domain.id))
      .returning();
    return domainView(row!);
  },
});

const listEmailLog = defineQuillsRoute({
  method: "get",
  path: "/support/email-log",
  operationId: "listQuillsRecentEmailLog",
  summary: "List the latest 50 email log entries",
  description: "Delivery errors and provider message IDs are not returned.",
  action: "manage_settings",
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        direction: z.string(),
        emailType: z.string(),
        provider: z.string().nullable(),
        address: z.string(),
        subject: z.string().nullable(),
        status: z.string(),
        conversationId: z.string().nullable(),
        ticketId: z.string().nullable(),
        postId: z.string().nullable(),
        createdAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "The latest email log entries",
  handler: async ({ db }) => ({
    items: await db
      .select({
        id: emailLog.id,
        direction: emailLog.direction,
        emailType: emailLog.emailType,
        provider: emailLog.provider,
        address: emailLog.address,
        subject: emailLog.subject,
        status: emailLog.status,
        conversationId: emailLog.conversationId,
        ticketId: emailLog.ticketId,
        postId: emailLog.postId,
        createdAt: emailLog.createdAt,
      })
      .from(emailLog)
      .orderBy(desc(emailLog.createdAt))
      .limit(50),
  }),
});

/** Teammate routes for email channel configuration. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getConfig)
  .openapi(...setForwarding)
  .openapi(...clearForwarding)
  .openapi(...setTrust)
  .openapi(...addAddress)
  .openapi(...setSmtp)
  .openapi(...removeAddress)
  .openapi(...removeDomain)
  .openapi(...restartChecks)
  .openapi(...listEmailLog);
