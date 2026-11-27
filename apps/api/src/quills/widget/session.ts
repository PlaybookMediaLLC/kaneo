import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { presenceStream } from "../../database/quills/schema/kv";
import {
  pageViews,
  visitorDevices,
} from "../../database/quills/schema/visitor-analytics";
import { isSpamBlocked } from "../framework/anti-spam";
import { mintWidgetSession, widgetEnabled } from "../framework/audience";
import { defineQuillsRoute } from "../framework/define-route";
import { signInLinkAvailable } from "../framework/sign-in-link";
import { verifyWidgetResumeToken } from "../framework/signed";
import { portalOn } from "../settings/area";
import { agentsOnline } from "../support/presence";

// The widget session itself, visitor presence heartbeats, resume-from-email, and device linking.

const getSession = defineQuillsRoute({
  audience: "widget",
  method: "get",
  path: "/widget/session",
  operationId: "getQuillsWidgetSession",
  summary: "Validate the widget session",
  description:
    "user is null for an anonymous visitor. The session expires 7 days after identify. canPortalHandoff is true for an identified visitor while the portal is on and the instance can mail a sign-in link (mail delivery on, login form on, no captcha).",
  action: "read",
  response: z.object({
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      })
      .nullable(),
    canPortalHandoff: z.boolean(),
  }),
  responseDescription: "The session's visitor",
  handler: async ({ db, caller }) => {
    const [row] = await db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        image: customer.image,
        type: principal.type,
        portalConfig: settings.portalConfig,
      })
      .from(principal)
      .innerJoin(customer, eq(customer.id, principal.userId))
      .leftJoin(settings, sql`true`)
      .where(eq(principal.id, caller.principalId!))
      .limit(1);
    const identified = row && row.type !== "anonymous";
    return {
      user: identified
        ? { id: row.id, name: row.name, email: row.email, avatarUrl: row.image }
        : null,
      canPortalHandoff: identified
        ? signInLinkAvailable() && portalOn(row.portalConfig)
        : false,
    };
  },
});

const linkDevice = defineQuillsRoute({
  audience: "widget",
  method: "post",
  path: "/widget/device",
  operationId: "linkQuillsWidgetDevice",
  summary: "Link the visitor's device to the widget session",
  description:
    "device is the untrusted device ID from host-page storage, scoped to this workspace. Earlier unclaimed page views of the device move to the session's visitor.",
  action: "update",
  // Not named deviceId: it is a caller-chosen value, not a reference to an existing record.
  body: z.object({ device: z.string().min(1).max(128) }),
  response: z.object({ linked: z.boolean() }),
  responseDescription: "The device is linked",
  event: {
    none: "Visitor analytics only; no customer or feedback record changes",
  },
  handler: async ({ db, caller, body }) => {
    const principalId = caller.principalId!;
    await db
      .insert(visitorDevices)
      .values({ deviceId: body.device, principalId })
      .onConflictDoUpdate({
        target: [visitorDevices.workspaceId, visitorDevices.deviceId],
        set: { principalId, lastSeenAt: sql`now()` },
      });
    await db
      .update(pageViews)
      .set({ principalId })
      .where(
        and(eq(pageViews.deviceId, body.device), isNull(pageViews.principalId)),
      );
    return { linked: true };
  },
});

const presenceHeartbeat = defineQuillsRoute({
  audience: "widget",
  method: "put",
  path: "/widget/presence",
  operationId: "heartbeatQuillsWidgetPresence",
  summary: "Record active widget visitor presence and read team online status",
  description:
    "Writes a 60-second heartbeat into presence_stream so email continuation (#319) waits while the visitor is actively viewing the widget.",
  action: "update",
  rateLimit: { limit: 120, windowSeconds: 600 },
  body: z.object({
    streamKey: z.string().min(1).max(64),
  }),
  response: z.object({
    ok: z.literal(true),
    teamOnline: z.boolean(),
  }),
  responseDescription: "Presence updated and team availability status",
  event: {
    none: "Ephemeral presence heartbeat writes no audit event",
  },
  handler: async ({ db, caller, body }) => {
    const principalId = caller.principalId!;
    await db
      .insert(presenceStream)
      .values({
        workspaceKey: "_",
        principalId,
        streamId: body.streamKey,
        isAgent: false,
        heartbeatAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          presenceStream.workspaceId,
          presenceStream.workspaceKey,
          presenceStream.principalId,
          presenceStream.streamId,
        ],
        set: { heartbeatAt: sql`now()` },
      });
    return { ok: true as const, teamOnline: await agentsOnline(db) };
  },
});

const resumeConversation = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/widget/resume",
  operationId: "resumeQuillsWidgetConversation",
  summary: "Resume a widget conversation from a signed email continuation link",
  description:
    "Exchanges a signed 7-day resume token from a chat-to-email continuation message (#319) for a fresh widget session token and conversationId.",
  action: "create",
  rateLimit: { limit: 30, windowSeconds: 600 },
  body: z.object({
    resumeToken: z.string().min(10).max(2048),
  }),
  response: z.object({
    sessionToken: z.string(),
    conversationId: z.string(),
  }),
  responseDescription: "Fresh widget session token and target conversation ID",
  errors: {
    403: "Invalid or expired resume token, or visitor blocked",
    404: "Widget disabled or conversation not found",
  },
  allowKeys: ["sessionToken"],
  event: {
    none: "Session resumption creates no domain entity",
  },
  handler: async ({ db, workspaceId, request, body }) => {
    const [cfg] = await db
      .select({
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings)
      .limit(1);
    if (!cfg || !widgetEnabled(cfg.widgetConfig) || !cfg.widgetSecret) {
      throw new HTTPException(404, { message: "Widget is not enabled" });
    }
    try {
      const parsedCfg = cfg.widgetConfig
        ? (JSON.parse(cfg.widgetConfig) as { tabs?: { messenger?: boolean } })
        : {};
      if (parsedCfg.tabs?.messenger === false) {
        throw new HTTPException(404, { message: "Messenger is not enabled" });
      }
    } catch (err) {
      if (err instanceof HTTPException) throw err;
    }
    const verified = verifyWidgetResumeToken(
      body.resumeToken,
      workspaceId,
      cfg.widgetSecret,
    );
    if (!verified) {
      throw new HTTPException(403, {
        message: "Invalid or expired resume token",
      });
    }
    const [conv] = await db
      .select({
        id: conversations.id,
        visitorPrincipalId: conversations.visitorPrincipalId,
        channel: conversations.channel,
        endReason: conversations.endReason,
        mergedIntoConversationId: conversations.mergedIntoConversationId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, verified.conversationId as never),
          eq(conversations.visitorPrincipalId, verified.principalId as never),
        ),
      )
      .limit(1);
    if (!conv || conv.channel !== "messenger") {
      throw new HTTPException(404, { message: "Conversation not found" });
    }
    if (conv.endReason === "spam") {
      throw new HTTPException(403, { message: "Conversation is unavailable" });
    }
    const [visitor] = await db
      .select({
        id: principal.id,
        userId: principal.userId,
        role: principal.role,
        kaneoUserId: principal.kaneoUserId,
        blockedAt: principal.blockedAt,
        mergedIntoPrincipalId: principal.mergedIntoPrincipalId,
      })
      .from(principal)
      .where(eq(principal.id, conv.visitorPrincipalId))
      .limit(1);
    if (
      !visitor ||
      visitor.blockedAt ||
      visitor.kaneoUserId ||
      visitor.role !== "user" ||
      visitor.mergedIntoPrincipalId ||
      !visitor.userId
    ) {
      throw new HTTPException(403, { message: "Visitor is blocked" });
    }
    const spamCheck = await isSpamBlocked(db, {
      ip: request.ip,
      principalId: visitor.id,
    });
    if (spamCheck.blocked) {
      throw new HTTPException(403, { message: "Visitor is blocked" });
    }
    let targetConversationId = conv.id;
    if (conv.mergedIntoConversationId) {
      const [mergedTarget] = await db
        .select({
          id: conversations.id,
          visitorPrincipalId: conversations.visitorPrincipalId,
          channel: conversations.channel,
          endReason: conversations.endReason,
        })
        .from(conversations)
        .where(eq(conversations.id, conv.mergedIntoConversationId))
        .limit(1);
      if (
        !mergedTarget ||
        mergedTarget.visitorPrincipalId !== visitor.id ||
        mergedTarget.channel !== "messenger" ||
        mergedTarget.endReason === "spam"
      ) {
        throw new HTTPException(403, {
          message: "Conversation is unavailable",
        });
      }
      targetConversationId = mergedTarget.id;
    }
    const session = await mintWidgetSession(
      db,
      { principalId: visitor.id, customerId: visitor.userId },
      cfg.widgetSecret,
    );
    return {
      sessionToken: session.token,
      conversationId: targetConversationId,
    };
  },
});

export default apiRouter()
  .openapi(...getSession)
  .openapi(...linkDevice)
  .openapi(...presenceHeartbeat)
  .openapi(...resumeConversation);
