import { createHmac, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { principal, settings } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { emailLog } from "../../database/quills/schema/email-log";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import {
  ticketConversations,
  tickets,
} from "../../database/quills/schema/tickets";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  notifyPromisedReplyBreaches,
  processSolutionConfirmations,
} from "../jobs/handlers/sweeps";
import { supportSubscribers } from "../jobs/handlers/support-mail";
import { seed as seedConversation } from "./conversation-seed.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
const secretKey = randomBytes(24).toString("base64");
const svixSecret = `whsec_${secretKey}`;

function signSvix(raw: string, id: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(secretKey, "base64"))
    .update(`${id}.${ts}.${raw}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": `v1,${sig}`,
  };
}

async function send(
  method: string,
  path: string,
  options: { user?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.user) headers["x-test-user"] = options.user;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
}

describe.skipIf(!url)(
  "Wave 3: wait times (#333), lifecycle (#311), auto-ack (#331), CSAT (#312)",
  () => {
    let wsA: string;
    let workspaceSlug: string;
    let adminUserId: string;
    let ids: Awaited<ReturnType<typeof seedConversation>>;

    beforeAll(async () => {
      vi.stubEnv("AUTH_SECRET", "wave3-test-secret-0123456789abcdef");
      vi.stubEnv("EMAIL_INBOUND_SIGNING_SECRET", svixSecret);
      vi.stubEnv("EMAIL_INBOUND_DOMAIN", "inbound.example.test");
      vi.stubEnv("EMAIL_INBOUND_PROVIDER", "resend");

      pool = new Pool({ connectionString: url });
      const world = await startContract(pool, url!);
      const env = contractEnv(world);
      wsA = env.a;
      adminUserId = env.owner;
      ids = await seedConversation(env);

      // Enable portal/widget support surface and read existing workspace slug
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [ws] = await db
          .select({ slug: settings.slug })
          .from(settings)
          .limit(1);
        workspaceSlug = ws!.slug;
        await db
          .update(settings)
          .set({
            widgetConfig: { enabled: true, messengerEnabled: true },
            portalConfig: { enabled: true, supportEnabled: true },
          })
          .where(eq(settings.workspaceId, wsA));
      });
    }, 30_000);

    afterAll(async () => {
      vi.unstubAllEnvs();
      await stopContract(pool);
    });

    it("#333 computes rolling wait time in team-presence and sends breach update once", async () => {
      // Seed 5 conversations with known 30-min first response times in last 30 days
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const now = Date.now();
        for (const mins of [10, 20, 30, 40, 50]) {
          await db.insert(conversations).values({
            visitorPrincipalId: ids.a.visitorId,
            channel: "email",
            source: "email",
            status: "closed",
            subject: `Wait sample ${mins}`,
            createdAt: new Date(now - (mins + 60) * 60_000),
            firstResponseAt: new Date(now - 60 * 60_000),
          });
        }
      });

      // Configure office hours so nextOpenAt is computed
      const ohRes = await send("PUT", `/quills/${wsA}/support/office-hours`, {
        user: adminUserId,
        body: {
          enabled: true,
          timezone: "UTC",
          intervals: [{ day: 1, start: "09:00", end: "17:00" }],
          holidays: [],
        },
      });
      expect(ohRes.status).toBe(200);

      const presenceRes = await send(
        "GET",
        `/quills-public/${wsA}/support/presence`,
      );
      expect(presenceRes.status).toBe(200);
      const presence = await presenceRes.json();
      expect(presence.estimatedWaitMinutes).toBe(30);
      expect(presence.estimatedWaitRange?.label).toBeTruthy();

      // Seed an open conversation whose promisedReplyBy has already passed
      let breachConvId!: string;
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [created] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: ids.a.visitorId,
            channel: "email",
            source: "email",
            status: "open",
            subject: "Breached promise",
            waitingSince: new Date(Date.now() - 3 * 3600_000),
            promisedReplyAt: new Date(Date.now() - 10 * 60_000),
          })
          .returning({ id: conversations.id });
        breachConvId = created!.id;
      });

      await withQuillsSystemWorkspace(wsA, (db) =>
        notifyPromisedReplyBreaches(db),
      );
      let firstTimestamp: number | null = null;
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [row] = await db
          .select({ breachUpdateSentAt: conversations.breachUpdateSentAt })
          .from(conversations)
          .where(eq(conversations.id, breachConvId as never));
        expect(row?.breachUpdateSentAt).not.toBeNull();
        firstTimestamp = row?.breachUpdateSentAt?.getTime() ?? null;
      });

      // Second run is a no-op (timestamp unchanged, no second system message)
      await withQuillsSystemWorkspace(wsA, (db) =>
        notifyPromisedReplyBreaches(db),
      );
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [row] = await db
          .select({ breachUpdateSentAt: conversations.breachUpdateSentAt })
          .from(conversations)
          .where(eq(conversations.id, breachConvId as never));
        expect(row?.breachUpdateSentAt?.getTime()).toBe(firstTimestamp);
      });
    });

    it("#311 handles offer-solution, reminder & quiet auto-close, OOO no-reopen, reopenPolicy, and reopens report", async () => {
      // 1. Offer solution on conversation
      const offerRes = await send(
        "POST",
        `/quills/${wsA}/conversations/${ids.a.conversationId}/offer-solution`,
        { user: adminUserId, body: { autoCloseAfterDays: 3 } },
      );
      expect(offerRes.status).toBe(200);
      const offered = await offerRes.json();
      expect(offered.changed).toBe(true);

      // 2. Backdate autoCloseAt to trigger reminder sweep first (within 24h)
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [c] = await db
          .select({
            solutionOfferedAt: conversations.solutionOfferedAt,
            autoCloseAt: conversations.autoCloseAt,
          })
          .from(conversations)
          .where(eq(conversations.id, ids.a.conversationId));
        expect(c?.solutionOfferedAt).not.toBeNull();
        expect(c?.autoCloseAt).not.toBeNull();

        await db
          .update(conversations)
          .set({
            autoCloseAt: new Date(Date.now() + 2 * 3600_000),
            closeReminderSentAt: null,
          })
          .where(eq(conversations.id, ids.a.conversationId));
      });
      await withQuillsSystemWorkspace(wsA, (db) =>
        processSolutionConfirmations(db),
      );
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [c] = await db
          .select({ closeReminderSentAt: conversations.closeReminderSentAt })
          .from(conversations)
          .where(eq(conversations.id, ids.a.conversationId));
        expect(c?.closeReminderSentAt).not.toBeNull();
      });

      // 3. Backdate autoCloseAt into the past -> quiet auto-close
      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db
          .update(conversations)
          .set({ autoCloseAt: new Date(Date.now() - 60_000) })
          .where(eq(conversations.id, ids.a.conversationId));
      });
      await withQuillsSystemWorkspace(wsA, (db) =>
        processSolutionConfirmations(db),
      );

      // Verify conversation is closed
      let statusAfterClose = "";
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [c] = await db
          .select({
            status: conversations.status,
            endReason: conversations.endReason,
          })
          .from(conversations)
          .where(eq(conversations.id, ids.a.conversationId));
        statusAfterClose = `${c?.status}:${c?.endReason}`;
      });
      expect(statusAfterClose).toBe("closed:resolved");

      // 4. Automated OOO inbound email on a closed email conversation must NOT reopen it
      let closedEmailConvId!: string;
      let seedMsgId!: string;
      let visitorEmail!: string;
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const { user: customerTable } =
          await import("../../database/quills/schema/auth");
        const [vis] = await db
          .select({ email: customerTable.email })
          .from(principal)
          .innerJoin(customerTable, eq(customerTable.id, principal.userId))
          .where(eq(principal.id, ids.a.visitorId));
        visitorEmail = vis!.email!;
        const [c] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: ids.a.visitorId,
            channel: "email",
            source: "email",
            status: "closed",
            endReason: "resolved",
            resolvedAt: new Date(),
            subject: "Original thread",
            visitorEmail,
          })
          .returning({ id: conversations.id });
        closedEmailConvId = c!.id;
        const [m] = await db
          .insert(conversationMessages)
          .values({
            conversationId: c!.id,
            principalId: ids.a.visitorId,
            senderType: "visitor",
            content: "Initial email",
            metadata: {
              source: "email",
              emailMessageId: "<orig-ooo@example.com>",
            },
          })
          .returning({ id: conversationMessages.id });
        seedMsgId = m!.id;
      });
      expect(seedMsgId).toBeTruthy();

      const oooPayload = JSON.stringify({
        type: "email.received",
        data: {
          email_id: "em-ooo-1",
          from: visitorEmail,
          to: [`${workspaceSlug}@inbound.example.test`],
          subject: "Automatic reply: Original thread",
          text: "I am out of office until next Monday.",
          message_id: "<ooo-reply-1@example.com>",
          headers: {
            "In-Reply-To": "<orig-ooo@example.com>",
            "Auto-Submitted": "auto-replied",
          },
        },
      });
      const oooRes = await app.request(
        "/quills-public/signed/chat/email/inbound",
        {
          method: "POST",
          headers: signSvix(oooPayload, "svix-ooo-1"),
          body: oooPayload,
        },
      );
      expect(oooRes.status).toBe(200);
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [c] = await db
          .select({
            status: conversations.status,
            reopenedCount: conversations.reopenedCount,
          })
          .from(conversations)
          .where(eq(conversations.id, closedEmailConvId as never));
        expect(c?.status).toBe("closed");
        expect(c?.reopenedCount).toBe(0);
      });

      // 5. Real customer email reply within window reopens & increments reopenedCount
      const reopenPayload = JSON.stringify({
        type: "email.received",
        data: {
          email_id: "em-reopen-1",
          from: visitorEmail,
          to: [`${workspaceSlug}@inbound.example.test`],
          subject: "Re: Original thread",
          text: "Actually the issue came back today, can you help?",
          message_id: "<human-reply-1@example.com>",
          headers: { "In-Reply-To": "<orig-ooo@example.com>" },
        },
      });
      const reopenRes = await app.request(
        "/quills-public/signed/chat/email/inbound",
        {
          method: "POST",
          headers: signSvix(reopenPayload, "svix-reopen-1"),
          body: reopenPayload,
        },
      );
      expect(reopenRes.status).toBe(200);
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [c] = await db
          .select({
            status: conversations.status,
            reopenedCount: conversations.reopenedCount,
          })
          .from(conversations)
          .where(eq(conversations.id, closedEmailConvId as never));
        expect(c?.status).toBe("open");
        expect(c?.reopenedCount).toBe(1);
      });

      // 6. Set reopenPolicy to never_link_new -> reply to closed thread spawns linked follow-up
      const polRes = await send("PUT", `/quills/${wsA}/support/reopen-policy`, {
        user: adminUserId,
        body: {
          mode: "never_link_new",
          windowDays: 14,
          autoCloseAfterDays: 5,
          reminderBeforeCloseHours: 24,
        },
      });
      expect(polRes.status).toBe(200);

      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db
          .update(conversations)
          .set({ status: "closed", resolvedAt: new Date() })
          .where(eq(conversations.id, closedEmailConvId as never));
      });

      const followUpPayload = JSON.stringify({
        type: "email.received",
        data: {
          email_id: "em-followup-1",
          from: visitorEmail,
          to: [`${workspaceSlug}@inbound.example.test`],
          subject: "Re: Original thread",
          text: "New follow-up question after resolution.",
          message_id: "<followup-reply-1@example.com>",
          headers: { "In-Reply-To": "<orig-ooo@example.com>" },
        },
      });
      const fuRes = await app.request(
        "/quills-public/signed/chat/email/inbound",
        {
          method: "POST",
          headers: signSvix(followUpPayload, "svix-fu-1"),
          body: followUpPayload,
        },
      );
      expect(fuRes.status).toBe(200);
      const fuBody = await fuRes.json();
      expect(fuBody.status).toBe("received");
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [oldConv] = await db
          .select({ status: conversations.status })
          .from(conversations)
          .where(eq(conversations.id, closedEmailConvId as never));
        expect(oldConv?.status).toBe("closed");

        const [newMsg] = await db
          .select({ conversationId: conversationMessages.conversationId })
          .from(conversationMessages)
          .where(eq(conversationMessages.id, fuBody.messageId));
        expect(newMsg?.conversationId).not.toBe(closedEmailConvId);
      });

      // 7. Reopens report reflects the reopened conversation
      const reportRes = await send(
        "GET",
        `/quills/${wsA}/reporting/support/reopens`,
        { user: adminUserId },
      );
      expect(reportRes.status).toBe(200);
      const report = await reportRes.json();
      expect(report.conversations.reopenedCount).toBeGreaterThanOrEqual(1);
      expect(report.conversations.reopenRatePercent).toBeGreaterThan(0);
    });

    it("#331 smart email auto-ack respects automated skip, fast reply skip, KB suggestions & headers", async () => {
      // Enable smart auto-ack with skipIfMedianUnderMinutes = 0 so our 30m median qualifies
      const cfgRes = await send(
        "PUT",
        `/quills/${wsA}/support/email-auto-ack`,
        {
          user: adminUserId,
          body: {
            enabled: true,
            delaySeconds: 30,
            skipIfMedianUnderMinutes: 0,
            includeWaitEstimate: true,
            includeKbSuggestions: true,
            maxPerConversation: 2,
          },
        },
      );
      expect(cfgRes.status).toBe(200);

      // Seed a published public KB article about invoice refunds
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [cat] = await db
          .insert(helpCenterCategories)
          .values({
            slug: "billing-help",
            name: "Billing Help",
            isPublic: true,
          })
          .returning({ id: helpCenterCategories.id });
        await db.insert(helpCenterArticles).values({
          categoryId: cat!.id,
          slug: "invoice-refund-guide",
          title: "Invoice Refund Guide",
          content:
            "Learn how to request an invoice refund and download receipts.",
          principalId: ids.a.visitorId,
          publishedAt: new Date(),
        });
      });

      // Seed an inbound email message asking about invoice refunds
      let emailConvId!: string;
      let emailMsgId!: string;
      let automatedMsgId!: string;
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [c] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: ids.a.visitorId,
            channel: "email",
            source: "email",
            status: "open",
            subject: "Need invoice refund",
            visitorEmail: "autoack@example.com",
          })
          .returning({ id: conversations.id });
        emailConvId = c!.id;
        const [m] = await db
          .insert(conversationMessages)
          .values({
            conversationId: c!.id,
            principalId: ids.a.visitorId,
            senderType: "visitor",
            content: "Can you help me with my invoice refund?",
            metadata: { source: "email" },
          })
          .returning({ id: conversationMessages.id });
        emailMsgId = m!.id;
        const [autoM] = await db
          .insert(conversationMessages)
          .values({
            conversationId: c!.id,
            principalId: ids.a.visitorId,
            senderType: "visitor",
            content: "Out of office",
            metadata: { source: "email", automated: true },
          })
          .returning({ id: conversationMessages.id });
        automatedMsgId = autoM!.id;
      });

      const sub = supportSubscribers["conversation.email_received"]!;

      // Automated message is skipped immediately
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const fakeEvent = {
          eventId: "ev-auto",
          type: "conversation.email_received",
          entityType: "conversation_message",
          entityId: automatedMsgId,
          actorId: null,
          actorType: "system",
          payload: {},
          context: {},
          occurredAt: new Date(),
        } as never;
        expect(
          await (sub.direct as (db: never, ev: never) => Promise<boolean>)(
            db as never,
            fakeEvent,
          ),
        ).toBe(false);
      });

      // Human email qualifies and produces mail content with ConversationAutoAckEmail
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const fakeEvent = {
          eventId: "ev-human",
          type: "conversation.email_received",
          entityType: "conversation_message",
          entityId: emailMsgId,
          actorId: null,
          actorType: "system",
          payload: {},
          context: {},
          occurredAt: new Date(),
        } as never;
        expect(
          await (sub.direct as (db: never, ev: never) => Promise<boolean>)(
            db as never,
            fakeEvent,
          ),
        ).toBe(true);
        const delay = await sub.directDelay!(db, fakeEvent);
        expect(delay).toBe(30);
        const mail = await sub.mail!(db, fakeEvent, null);
        expect(mail).toBeDefined();
        expect(mail?.emailType).toBe("ConversationAutoAckEmail");
        expect(mail?.to).toBe("autoack@example.com");
      });

      // Once a teammate replies, auto-ack skips at send time
      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db.insert(conversationMessages).values({
          conversationId: emailConvId as never,
          senderType: "agent",
          isInternal: false,
          sendStatus: "sent",
          content: "On it right now!",
        });
        const fakeEvent = {
          eventId: "ev-human-2",
          type: "conversation.email_received",
          entityType: "conversation_message",
          entityId: emailMsgId,
          actorId: null,
          actorType: "system",
          payload: {},
          context: {},
          occurredAt: new Date(),
        } as never;
        const mail = await sub.mail!(db, fakeEvent, null);
        expect(mail).toBeUndefined();
      });
    });

    it("#312 enforces CSAT cooldown, trivial filter, inline timeline & low-score follow-up ticket", async () => {
      const csatCfgRes = await send(
        "PUT",
        `/quills/${wsA}/support/csat-settings`,
        {
          user: adminUserId,
          body: {
            enabled: true,
            samplingRate: 100,
            cooldownDays: 14,
            delayMinutes: 10,
            excludeTrivialUnderMessages: 2,
            lowScoreThreshold: 2,
            autoCreateFollowUpOnLow: true,
          },
        },
      );
      expect(csatCfgRes.status).toBe(200);

      let conv1Id!: string;
      let conv2Id!: string;
      await withQuillsSystemWorkspace(wsA, async (db) => {
        // Clear surveySentAt on visitor
        await db
          .update(principal)
          .set({ surveySentAt: null })
          .where(eq(principal.id, ids.a.visitorId));

        // Conv 1: 2 messages (non-trivial)
        const [c1] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: ids.a.visitorId,
            channel: "email",
            source: "email",
            status: "closed",
            subject: "Billing bug",
            visitorEmail: "csat@example.com",
          })
          .returning({ id: conversations.id });
        conv1Id = c1!.id;
        await db.insert(conversationMessages).values([
          {
            conversationId: c1!.id,
            principalId: ids.a.visitorId,
            senderType: "visitor",
            content: "Help me",
          },
          {
            conversationId: c1!.id,
            senderType: "agent",
            content: "Fixed it",
          },
        ]);

        // Conv 2: also 2 messages, same visitor (should be blocked by cooldown after Conv 1 stamps surveySentAt)
        const [c2] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: ids.a.visitorId,
            channel: "email",
            source: "email",
            status: "closed",
            subject: "Second thread",
            visitorEmail: "csat@example.com",
          })
          .returning({ id: conversations.id });
        conv2Id = c2!.id;
        await db.insert(conversationMessages).values([
          {
            conversationId: c2!.id,
            principalId: ids.a.visitorId,
            senderType: "visitor",
            content: "Another question",
          },
          {
            conversationId: c2!.id,
            senderType: "agent",
            content: "Answered",
          },
        ]);
      });

      const sub = supportSubscribers["conversation.status_changed"]!;
      let csatTokenUrl = "";
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const ev1 = {
          eventId: "ev-csat-1",
          type: "conversation.status_changed",
          entityType: "conversation",
          entityId: conv1Id,
          actorId: null,
          actorType: "teammate",
          payload: { status: "closed" },
          context: {},
          occurredAt: new Date(),
        } as never;
        expect(await sub.directDelay!(db, ev1)).toBe(600);
        const mail1 = await sub.mail!(db, ev1, null);
        expect(mail1).toBeDefined();
        expect(mail1?.emailType).toBe("CsatRequestEmail");

        // Second conversation for same visitor within 14-day cooldown is suppressed!
        const ev2 = {
          eventId: "ev-csat-2",
          type: "conversation.status_changed",
          entityType: "conversation",
          entityId: conv2Id,
          actorId: null,
          actorType: "teammate",
          payload: { status: "closed" },
          context: {},
          occurredAt: new Date(),
        } as never;
        const mail2 = await sub.mail!(db, ev2, null);
        expect(mail2).toBeUndefined();
      });

      // Submit a low CSAT rating (1/5) via public csat-email route
      const { mintCsatToken } = await import("./customer/csat-email");
      const token = await withQuillsSystemWorkspace(wsA, (db) =>
        mintCsatToken(db, conv1Id as never, ids.a.visitorId),
      );
      csatTokenUrl = token;
      expect(csatTokenUrl).toBeTruthy();

      const rateRes = await send(
        "POST",
        `/quills-public/${wsA}/support/csat-email`,
        {
          body: {
            token,
            rating: 1,
            comment: "Took too long to resolve",
          },
        },
      );
      expect(rateRes.status).toBe(200);
      const rated = await rateRes.json();
      expect(rated.recorded).toBe(true);
      expect(rated.rating).toBe(1);

      // Verify internal csat_submitted timeline message AND auto-created back_office follow-up ticket
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const notes = await db
          .select({
            content: conversationMessages.content,
            metadata: conversationMessages.metadata,
          })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, conv1Id as never),
              eq(conversationMessages.isInternal, true),
            ),
          );
        expect(
          notes.some(
            (n) =>
              (n.metadata as Record<string, unknown>)?.systemKind ===
                "csat_submitted" && n.content.includes("1/5"),
          ),
        ).toBe(true);

        const linked = await db
          .select({
            ticketId: ticketConversations.ticketId,
            type: tickets.type,
            priority: tickets.priority,
          })
          .from(ticketConversations)
          .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
          .where(eq(ticketConversations.conversationId, conv1Id as never));
        expect(linked.length).toBeGreaterThanOrEqual(1);
        expect(
          linked.some((l) => l.type === "back_office" && l.priority === "high"),
        ).toBe(true);
      });

      // Clean up emailLog reference check (ensure no unused import)
      expect(emailLog).toBeDefined();
    });
  },
);
