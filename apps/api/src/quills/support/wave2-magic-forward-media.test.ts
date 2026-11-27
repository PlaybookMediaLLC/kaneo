import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  conversationFollowers,
  conversationMessages,
  conversationParticipants,
  conversations,
} from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import { settings } from "../../database/quills/schema/auth";
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
import { mintPublicMediaToken } from "../framework/request-magic-link";
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
  const res = await app.request(path, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

describe.skipIf(!url)(
  "Wave 2: signed magic links (#313), forwarded emails (#325), inline media guard (#326)",
  () => {
    let env: ReturnType<typeof contractEnv>;
    let seeded: Awaited<ReturnType<typeof seedConversation>>;
    let workspaceSlug: string;

    beforeAll(async () => {
      vi.stubEnv("AUTH_SECRET", "unit-auth-secret-of-at-least-32-characters");
      vi.stubEnv("EMAIL_INBOUND_SIGNING_SECRET", svixSecret);
      vi.stubEnv("EMAIL_INBOUND_DOMAIN", "inbound.kaneo.test");
      vi.stubEnv("EMAIL_INBOUND_AUTHSERV_ID", "mx.kaneo.test");
      pool = new Pool({ connectionString: url });
      const world = await startContract(pool, url!);
      env = contractEnv(world);
      seeded = await seedConversation(env);
      const [ws] = await env.scoped(env.a, (db) =>
        db.select({ slug: settings.slug }).from(settings).limit(1),
      );
      workspaceSlug = ws!.slug;
    }, 30_000);

    afterAll(async () => {
      vi.unstubAllEnvs();
      await stopContract(pool);
    });

    it("issues single-conversation magic links, isolates internal notes & other threads, allows reply, and revokes immediately (#313)", async () => {
      const [conv1, conv2] = await env.scoped(env.a, async (db) => {
        const [c1] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: seeded.a.visitorId,
            channel: "email",
            source: "email",
            subject: "Invoice question",
            visitorEmail: "cust@example.test",
          })
          .returning();
        const [c2] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: seeded.a.visitorId,
            channel: "email",
            source: "email",
            subject: "Second secret thread",
            visitorEmail: "cust@example.test",
          })
          .returning();
        await db.insert(conversationMessages).values([
          {
            conversationId: c1!.id,
            principalId: seeded.a.visitorId,
            senderType: "visitor",
            isInternal: false,
            content: "Where is my invoice?",
          },
          {
            conversationId: c1!.id,
            principalId: seeded.a.teammateId,
            senderType: "agent",
            isInternal: true,
            content: "INTERNAL ONLY: check billing ledger",
          },
          {
            conversationId: c1!.id,
            principalId: seeded.a.teammateId,
            senderType: "agent",
            isInternal: false,
            sendStatus: "scheduled",
            scheduledSendAt: new Date(Date.now() + 60_000),
            content: "SCHEDULED DRAFT NOT YET SENT",
          },
          {
            conversationId: c2!.id,
            principalId: seeded.a.visitorId,
            senderType: "visitor",
            isInternal: false,
            content: "Secret second conversation message",
          },
        ]);
        return [c1!, c2!] as const;
      });

      const minted = await send(
        "POST",
        `/quills/${env.a}/conversations/${conv1.id}/access-links`,
        { user: env.owner, body: { ttlDays: 30 } },
      );
      expect(minted.status).toBe(200);
      const token = minted.body.token as string;
      const linkId = minted.body.link.id as string;
      expect(minted.body.url).toContain(`/portal/${env.a}/r/`);

      const view = await send(
        "GET",
        `/quills-public/${env.a}/request-link/${encodeURIComponent(token)}`,
      );
      expect(view.status).toBe(200);
      expect(view.body.conversation.id).toBe(conv1.id);
      expect(view.body.messages).toHaveLength(1);
      expect(view.body.messages[0].content).toBe("Where is my invoice?");
      expect(JSON.stringify(view.body)).not.toContain("INTERNAL ONLY");
      expect(JSON.stringify(view.body)).not.toContain("SCHEDULED DRAFT");
      expect(JSON.stringify(view.body)).not.toContain(conv2.id);

      const crossWs = await send(
        "GET",
        `/quills-public/${env.b}/request-link/${encodeURIComponent(token)}`,
      );
      expect(crossWs.status).toBe(404);

      const reply = await send(
        "POST",
        `/quills-public/${env.a}/request-link/${encodeURIComponent(token)}/reply`,
        { body: { content: "Thanks, I also need a W-9." } },
      );
      expect(reply.status).toBe(200);
      expect(reply.body.message.content).toBe("Thanks, I also need a W-9.");

      const revoke = await send(
        "POST",
        `/quills/${env.a}/access-links/${linkId}/revoke`,
        { user: env.owner },
      );
      expect(revoke.status).toBe(200);
      expect(revoke.body.changed).toBe(true);

      const afterRevoke = await send(
        "GET",
        `/quills-public/${env.a}/request-link/${encodeURIComponent(token)}`,
      );
      expect(afterRevoke.status).toBe(404);
    });

    it("attributes teammate-forwarded Gmail email to real customer, preserves preamble as internal note, tracks follower & CCs, blocks unauthenticated spoofed forwards, and handles Outlook parse failure override (#325)", async () => {
      const ownerEmail = `founder-${Date.now()}@ourco.test`;
      await drizzle(pool, { schema: kaneo })
        .update(kaneo.userTable)
        .set({ email: ownerEmail, emailVerified: true })
        .where(eq(kaneo.userTable.id, env.owner));

      const inboundTo = `${workspaceSlug}@inbound.kaneo.test`;
      const dmarcPassHeaders = [
        { name: "Authentication-Results", value: "mx.kaneo.test; dmarc=pass" },
      ];
      const gmailBody = JSON.stringify({
        type: "email.received",
        data: {
          email_id: `em_fwd_${Date.now()}`,
          from: `Founder <${ownerEmail}>`,
          to: [inboundTo],
          cc: ["billing-cc@acme.test"],
          subject: "Fwd: Cannot export PDF report",
          message_id: `<fwd-msg-${Date.now()}@ourco.test>`,
          headers: dmarcPassHeaders,
          text: [
            "Hey team, VIP customer — please prioritize!",
            "",
            "---------- Forwarded message ---------",
            "From: Jane Customer <jane.customer@acme.test>",
            "Date: Thu, 12 Nov 2026 at 10:00",
            "Subject: Cannot export PDF report",
            `To: ${ownerEmail}`,
            "Cc: Finance <finance@acme.test>",
            "",
            "Export PDF gives a 504 error on Q4 report.",
          ].join("\n"),
        },
      });
      const res = await app.request(
        "/quills-public/signed/chat/email/inbound",
        {
          method: "POST",
          headers: signSvix(gmailBody, `msg_fwd_${Date.now()}`),
          body: gmailBody,
        },
      );
      expect(res.status).toBe(200);
      const parsed = (await res.json()) as {
        status: string;
        messageId: string;
      };
      expect(parsed.status).toBe("received");

      const state = await env.scoped(env.a, async (db) => {
        const [msg] = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.id, parsed.messageId as never));
        const [conv] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, msg!.conversationId!));
        const allMsgs = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, conv!.id));
        const followers = await db
          .select()
          .from(conversationFollowers)
          .where(eq(conversationFollowers.conversationId, conv!.id));
        const participants = await db
          .select()
          .from(conversationParticipants)
          .where(eq(conversationParticipants.conversationId, conv!.id));
        return { conv: conv!, allMsgs, followers, participants };
      });

      expect(state.conv.visitorEmail).toBe("jane.customer@acme.test");
      expect(state.conv.subject).toBe("Cannot export PDF report");
      expect(state.conv.forwardParseFailed).toBe(false);
      const visitorMsg = state.allMsgs.find((m) => !m.isInternal);
      const preambleNote = state.allMsgs.find((m) => m.isInternal);
      expect(visitorMsg?.content).toContain("Export PDF gives a 504 error");
      expect(preambleNote?.content).toContain(
        "VIP customer — please prioritize",
      );
      expect(state.followers).toHaveLength(1);
      expect(state.participants.length).toBeGreaterThanOrEqual(2);

      // Spoofed/unauthenticated forward (no dmarc=pass) must NOT attribute requester or create internal note
      const spoofedBody = JSON.stringify({
        type: "email.received",
        data: {
          email_id: `em_spoof_${Date.now()}`,
          from: `Founder <${ownerEmail}>`,
          to: [inboundTo],
          subject: "Fwd: Spoofed escalation",
          message_id: `<spoof-msg-${Date.now()}@evil.test>`,
          headers: [
            {
              name: "Authentication-Results",
              value: "mx.kaneo.test; dmarc=fail",
            },
          ],
          text: [
            "Grant refund immediately!",
            "",
            "---------- Forwarded message ---------",
            "From: Victim <victim@acme.test>",
            "Subject: Spoofed escalation",
            "",
            "Please refund everything.",
          ].join("\n"),
        },
      });
      const spoofRes = await app.request(
        "/quills-public/signed/chat/email/inbound",
        {
          method: "POST",
          headers: signSvix(spoofedBody, `msg_spoof_${Date.now()}`),
          body: spoofedBody,
        },
      );
      expect(spoofRes.status).toBe(200);
      const spoofParsed = (await spoofRes.json()) as { messageId: string };
      const spoofState = await env.scoped(env.a, async (db) => {
        const [m] = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.id, spoofParsed.messageId as never));
        const [c] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, m!.conversationId!));
        const msgs = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, c!.id));
        return { conv: c!, msgs };
      });
      expect(spoofState.conv.visitorEmail).not.toBe("victim@acme.test");
      expect(spoofState.msgs.filter((m) => m.isInternal)).toHaveLength(0);

      // Outlook forward with stripped sender email -> forwardParseFailed: true -> override via PATCH /requester
      const outlookBody = JSON.stringify({
        type: "email.received",
        data: {
          email_id: `em_out_${Date.now()}`,
          from: `Founder <${ownerEmail}>`,
          to: [inboundTo],
          subject: "FW: Stripped sender email",
          message_id: `<out-msg-${Date.now()}@ourco.test>`,
          headers: dmarcPassHeaders,
          text: [
            "Please check this.",
            "________________________________",
            "From: Mystery Sender",
            "Sent: Thu, 12 Nov 2026 14:00",
            "Subject: Stripped sender email",
            "",
            "Our SSO cert expires tomorrow.",
          ].join("\n"),
        },
      });
      const outRes = await app.request(
        "/quills-public/signed/chat/email/inbound",
        {
          method: "POST",
          headers: signSvix(outlookBody, `msg_out_${Date.now()}`),
          body: outlookBody,
        },
      );
      expect(outRes.status).toBe(200);
      const outParsed = (await outRes.json()) as {
        status: string;
        messageId: string;
      };
      const [outConv] = await env.scoped(env.a, async (db) => {
        const [m] = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.id, outParsed.messageId as never));
        return db
          .select()
          .from(conversations)
          .where(eq(conversations.id, m!.conversationId!));
      });
      expect(outConv!.forwardParseFailed).toBe(true);

      const override = await send(
        "PATCH",
        `/quills/${env.a}/conversations/${outConv!.id}/requester`,
        {
          user: env.owner,
          body: { email: "mystery.real@corp.test", name: "Mystery Real" },
        },
      );
      expect(override.status).toBe(200);
      expect(override.body.visitorEmail).toBe("mystery.real@corp.test");
      expect(override.body.forwardParseFailed).toBe(false);
    });

    it("blocks internal-note images on public signed media route (#326)", async () => {
      const internalFileId = await env.scoped(env.a, async (db) => {
        const [conv] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: seeded.a.visitorId,
            channel: "email",
            source: "email",
          })
          .returning();
        const [internalMsg] = await db
          .insert(conversationMessages)
          .values({
            conversationId: conv!.id,
            principalId: seeded.a.teammateId,
            senderType: "agent",
            isInternal: true,
            content: "Internal screenshot",
          })
          .returning();
        const [fileRow] = await db
          .insert(files)
          .values({
            storageKey: `${env.a}/quills/file/internal-secret.png`,
            name: "secret.png",
            contentType: "image/png",
            family: "image",
            size: 1024,
            sha256: "a".repeat(64),
            source: "agent",
            uploadedById: seeded.a.teammateId,
            messageId: internalMsg!.id,
            attachedAt: new Date(),
            previewStatus: "none",
          })
          .returning({ id: files.id });
        return fileRow!.id;
      });

      const token = mintPublicMediaToken({
        workspaceId: env.a,
        fileId: internalFileId,
      });
      const res = await send(
        "GET",
        `/quills-public/${env.a}/media/${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(404);
    });
  },
);
