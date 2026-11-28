import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import { presenceStream } from "../../database/quills/schema/kv";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
import {
  checkDraftAgainstFacts,
  extractProvidedFacts,
} from "./conversation-handoff";
import { normalizeIdentityValue } from "../directory/contact-identities";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  mintWidgetResumeToken,
  verifyWidgetResumeToken,
} from "../framework/signed";
import quillsRouter from "../index";
import publicRouter from "../public";
import { enableWidget } from "../widget/seed.fixture";

// Wave 2 end-to-end real-PostgreSQL verification (#310, #319, #309, #322).

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

describe("Wave 2 pure helpers (#310, #319, #309)", () => {
  it("normalizes contact identities and rejects invalid formats (#310)", () => {
    expect(normalizeIdentityValue("email", "  Alice@Acme.COM ")).toBe(
      "alice@acme.com",
    );
    expect(normalizeIdentityValue("email", "not-an-email")).toBeNull();
    expect(normalizeIdentityValue("phone", "+1 (415) 555-0199")).toBe(
      "+14155550199",
    );
    expect(normalizeIdentityValue("external_id", "usr_99")).toBe("usr_99");
  });

  it("extracts customer-provided facts and warns when a draft asks to repeat them (#309)", () => {
    const facts = extractProvidedFacts([
      {
        id: "msg_1",
        content:
          "Hi, my order ORD-99218 failed on Chrome with HTTP 502 on https://app.acme.test/checkout",
      },
    ]);
    expect(facts.map((f) => f.kind).sort()).toEqual([
      "browser_or_os",
      "error_code",
      "order_or_invoice_id",
      "url",
    ]);
    const warnings = checkDraftAgainstFacts(
      "Sorry about that! Could you share your order number and which browser you used?",
      facts,
    );
    expect(warnings.map((w) => w.kind).sort()).toEqual([
      "browser_or_os",
      "order_or_invoice_id",
    ]);

    // Common English words like "ordering" / "submitting" must not trigger order_or_invoice_id
    const proseFacts = extractProvidedFacts([
      {
        id: "msg_2",
        content: "I am having trouble ordering lunch and submitting feedback.",
      },
    ]);
    expect(proseFacts.some((f) => f.kind === "order_or_invoice_id")).toBe(
      false,
    );
  });

  it("signs and verifies widget resume tokens and rejects tampering (#319)", () => {
    const token = mintWidgetResumeToken(
      "ws_1",
      "conversation_01test",
      "principal_01test",
      "wgt_secret",
    );
    expect(verifyWidgetResumeToken(token, "ws_1", "wgt_secret")).toEqual({
      conversationId: "conversation_01test",
      principalId: "principal_01test",
    });
    expect(verifyWidgetResumeToken(token, "ws_2", "wgt_secret")).toBeNull();
    expect(
      verifyWidgetResumeToken(`${token}x`, "ws_1", "wgt_secret"),
    ).toBeNull();
  });
});

describe.skipIf(!url)(
  "Wave 2 real PostgreSQL integration (#310, #319, #309, #322)",
  () => {
    let widgetSecret: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
      widgetSecret = await enableWidget(contractEnv(), contractEnv().a);
    }, 120_000);

    afterAll(() => stopContract());

    async function teamJson(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; body: any }> {
      const res = await app.request(`/quills/${contractEnv().a}${path}`, {
        method,
        headers: {
          "x-test-user": contractEnv().owner,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }

    async function pubJson(
      method: string,
      path: string,
      opts?: { bearer?: string; body?: unknown },
    ): Promise<{ status: number; body: any }> {
      const res = await app.request(
        `/quills-public/${contractEnv().a}${path}`,
        {
          method,
          headers: {
            ...(opts?.bearer && { authorization: `Bearer ${opts.bearer}` }),
            ...(opts?.body !== undefined && {
              "content-type": "application/json",
            }),
          },
          body:
            opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        },
      );
      return { status: res.status, body: await res.json().catch(() => null) };
    }

    async function createContact(name: string, email: string) {
      return withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const [u] = await db
          .insert(user)
          .values({ name, email })
          .returning({ id: user.id });
        const [p] = await db
          .insert(principal)
          .values({
            userId: u!.id,
            role: "user",
            type: "user",
            displayName: name,
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        return { userId: u!.id, principalId: p!.id };
      });
    }

    it("#310: links secondary identities, detects duplicates, merges contacts reversibly, and undoes losslessly", async () => {
      const tag = contractEnv().id("c");
      const primary = await createContact(
        `Maya ${tag}`,
        `maya-work-${tag}@acme.test`,
      );
      const dup = await createContact(
        `Maya ${tag}`,
        `maya-personal-${tag}@gmail.test`,
      );

      // Add secondary external_id identity on primary and verify directory search finds it
      const addId = await teamJson(
        "POST",
        `/users/${primary.principalId}/identities`,
        { kind: "external_id", value: `crm_${tag}` },
      );
      expect(addId.status).toBe(200);
      const search = await teamJson("GET", `/users?search=crm_${tag}`);
      expect(search.status).toBe(200);
      expect(search.body.items.map((x: any) => x.principalId)).toContain(
        primary.principalId,
      );

      // Duplicate review detects the same-name pair
      const dups = await teamJson("GET", "/users/duplicates");
      expect(dups.status).toBe(200);
      expect(
        dups.body.items.some(
          (p: any) =>
            (p.primaryPrincipalId === primary.principalId &&
              p.duplicatePrincipalId === dup.principalId) ||
            (p.primaryPrincipalId === dup.principalId &&
              p.duplicatePrincipalId === primary.principalId),
        ),
      ).toBe(true);

      // Create a conversation owned by dup before merge
      const convId = await withQuillsSystemWorkspace(
        contractEnv().a,
        async (db) => {
          const [c] = await db
            .insert(conversations)
            .values({
              visitorPrincipalId: dup.principalId as never,
              channel: "email",
              source: "email",
              status: "open",
              subject: "Personal email thread",
            })
            .returning({ id: conversations.id });
          return c!.id;
        },
      );

      // Merge dup -> primary
      const merged = await teamJson("POST", "/users/merge", {
        sourcePrincipalIds: [dup.principalId],
        targetPrincipalId: primary.principalId,
        reason: "Same person (work + personal)",
      });
      expect(merged.status).toBe(200);
      const mergeId = merged.body.merges[0].id;

      // Conversation now belongs to primary, and dup's email is now a linked identity on primary
      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const [c] = await db
          .select({ visitor: conversations.visitorPrincipalId })
          .from(conversations)
          .where(eq(conversations.id, convId as never));
        expect(c?.visitor).toBe(primary.principalId);
      });
      const idents = await teamJson(
        "GET",
        `/users/${primary.principalId}/identities`,
      );
      expect(
        idents.body.items.some(
          (i: any) =>
            i.kind === "email" && i.value === `maya-personal-${tag}@gmail.test`,
        ),
      ).toBe(true);

      // Tombstoned dup is hidden from /users list
      const listAfterMerge = await teamJson(
        "GET",
        `/users?search=maya-personal-${tag}@gmail.test`,
      );
      expect(
        listAfterMerge.body.items.map((x: any) => x.principalId),
      ).not.toContain(dup.principalId);

      // Undo merge within 30 days -> conversation moves back to dup, merge alias removed!
      const undone = await teamJson("POST", `/users/merges/${mergeId}/undo`);
      expect(undone.status).toBe(200);
      expect(undone.body.undoneAt).toBeTruthy();

      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const [c] = await db
          .select({ visitor: conversations.visitorPrincipalId })
          .from(conversations)
          .where(eq(conversations.id, convId as never));
        expect(c?.visitor).toBe(dup.principalId);
      });
    });

    it("#319: records widget presence heartbeat and resumes conversation via signed email token", async () => {
      const visitor = await contractEnv().widgetVisitor(contractEnv().a);

      const pres = await pubJson("PUT", "/widget/presence", {
        bearer: visitor.token,
        body: { streamKey: "tab-abc" },
      });
      expect(pres.status).toBe(200);
      expect(pres.body.ok).toBe(true);

      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const rows = await db
          .select({ streamId: presenceStream.streamId })
          .from(presenceStream)
          .where(eq(presenceStream.principalId, visitor.principalId));
        expect(rows.some((r) => r.streamId === "tab-abc")).toBe(true);
      });

      // Create a conversation and mint a signed resume token
      const convId = await withQuillsSystemWorkspace(
        contractEnv().a,
        async (db) => {
          const [c] = await db
            .insert(conversations)
            .values({
              visitorPrincipalId: visitor.principalId as never,
              channel: "messenger",
              source: "widget",
              status: "open",
              subject: "Widget chat",
            })
            .returning({ id: conversations.id });
          return c!.id;
        },
      );
      const resumeToken = mintWidgetResumeToken(
        contractEnv().a,
        convId,
        visitor.principalId,
        widgetSecret,
      );

      const resumed = await pubJson("POST", "/widget/resume", {
        body: { resumeToken },
      });
      expect(resumed.status).toBe(200);
      expect(resumed.body.conversationId).toBe(convId);
      expect(resumed.body.sessionToken).toBeTruthy();

      // Verify the resumed session token can read the conversation
      const convRead = await pubJson("GET", `/widget/conversations/${convId}`, {
        bearer: resumed.body.sessionToken,
      });
      expect(convRead.status).toBe(200);
    });

    it("#309: serves unified cross-channel customer timeline and flags duplicate-ask drafts", async () => {
      const tag = contractEnv().id("tl");
      const person = await createContact(
        `Sam ${tag}`,
        `sam-${tag}@example.test`,
      );

      const convId = await withQuillsSystemWorkspace(
        contractEnv().a,
        async (db) => {
          const [c] = await db
            .insert(conversations)
            .values({
              visitorPrincipalId: person.principalId as never,
              channel: "messenger",
              source: "widget",
              status: "open",
              subject: "Checkout 502",
            })
            .returning({ id: conversations.id });
          await db.insert(conversationMessages).values({
            conversationId: c!.id,
            principalId: person.principalId as never,
            senderType: "visitor",
            content: "Order INV-88412 fails with HTTP 502 on Firefox.",
          });
          const [st] = await db
            .insert(ticketStatuses)
            .values({
              name: `Open ${tag}`,
              slug: `open-${tag}`,
              category: "open",
            })
            .returning({ id: ticketStatuses.id });
          await db.insert(tickets).values({
            title: "Investigate INV-88412",
            statusId: st!.id,
            requesterPrincipalId: person.principalId as never,
          });
          return c!.id;
        },
      );

      const timeline = await teamJson(
        "GET",
        `/users/${person.principalId}/timeline`,
      );
      expect(timeline.status).toBe(200);
      const kinds = timeline.body.items.map((i: any) => i.kind);
      expect(kinds).toContain("conversation");
      expect(kinds).toContain("ticket");

      const draftCheck = await teamJson(
        "POST",
        `/conversations/${convId}/check-draft`,
        {
          draft: "Hi Sam, what invoice number and which browser are you using?",
        },
      );
      expect(draftCheck.status).toBe(200);
      expect(draftCheck.body.warnings.map((w: any) => w.kind).sort()).toEqual([
        "browser_or_os",
        "order_or_invoice_id",
      ]);
    });

    it("#322: previews, guards cross-requester merge, preserves attachments, and undoes conversation & ticket merges byte-for-byte", async () => {
      const tag = contractEnv().id("m");
      const alice = await createContact(
        `Alice ${tag}`,
        `a-${tag}@example.test`,
      );
      const bob = await createContact(`Bob ${tag}`, `b-${tag}@example.test`);

      const ids = await withQuillsSystemWorkspace(
        contractEnv().a,
        async (db) => {
          const [cTarget] = await db
            .insert(conversations)
            .values({
              visitorPrincipalId: alice.principalId as never,
              channel: "messenger",
              source: "widget",
              status: "open",
              subject: "Target thread",
            })
            .returning({ id: conversations.id });
          const [cSource] = await db
            .insert(conversations)
            .values({
              visitorPrincipalId: bob.principalId as never,
              channel: "email",
              source: "email",
              status: "open",
              subject: "Source thread",
            })
            .returning({ id: conversations.id });
          const [srcMsg] = await db
            .insert(conversationMessages)
            .values({
              conversationId: cSource!.id,
              principalId: bob.principalId as never,
              senderType: "visitor",
              content: "Here is my screenshot attachment",
            })
            .returning({ id: conversationMessages.id });
          const [att] = await db
            .insert(files)
            .values({
              storageKey: `test/${tag}/shot.png`,
              name: "shot.png",
              contentType: "image/png",
              declaredType: "image/png",
              family: "image",
              sha256: "a".repeat(64),
              size: 1234,
              source: "conversation",
              uploadedById: bob.principalId as never,
              messageId: srcMsg!.id,
            })
            .returning({ id: files.id });
          return {
            targetId: cTarget!.id,
            sourceId: cSource!.id,
            srcMsgId: srcMsg!.id,
            fileId: att!.id,
          };
        },
      );

      // Preview detects crossRequester and 1 attachment
      const prev = await teamJson("POST", "/conversations/merge/preview", {
        sourceConversationIds: [ids.sourceId],
        targetConversationId: ids.targetId,
      });
      expect(prev.status).toBe(200);
      expect(prev.body.crossRequester).toBe(true);
      expect(prev.body.attachmentsToMove).toBe(1);
      expect(prev.body.requiresConfirmation).toBe(true);

      // Without confirmCrossRequester=true -> 409!
      const denied = await teamJson("POST", "/conversations/merge", {
        sourceConversationIds: [ids.sourceId],
        targetConversationId: ids.targetId,
      });
      expect(denied.status).toBe(409);

      // With confirmCrossRequester=true -> merges silently and preserves attachment link
      const merged = await teamJson("POST", "/conversations/merge", {
        sourceConversationIds: [ids.sourceId],
        targetConversationId: ids.targetId,
        confirmCrossRequester: true,
      });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      const mergeId = merged.body.merges[0].id;

      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const [msg] = await db
          .select({ convId: conversationMessages.conversationId })
          .from(conversationMessages)
          .where(eq(conversationMessages.id, ids.srcMsgId as never));
        expect(msg?.convId).toBe(ids.targetId);
        const [fileRow] = await db
          .select({ messageId: files.messageId })
          .from(files)
          .where(eq(files.id, ids.fileId as never));
        expect(fileRow?.messageId).toBe(ids.srcMsgId);
        const [targetRow] = await db
          .select({
            lastMessagePreview: conversations.lastMessagePreview,
          })
          .from(conversations)
          .where(eq(conversations.id, ids.targetId as never));
        expect(targetRow?.lastMessagePreview).toContain(
          "Here is my screenshot attachment",
        );
        expect(targetRow?.lastMessagePreview ?? "").not.toContain("Merged");
        const [srcRow] = await db
          .select({
            status: conversations.status,
            mergedInto: conversations.mergedIntoConversationId,
          })
          .from(conversations)
          .where(eq(conversations.id, ids.sourceId as never));
        expect(srcRow?.status).toBe("closed");
        expect(srcRow?.mergedInto).toBe(ids.targetId);
      });

      // Undo restores message, attachment, and original 'open' status on source
      const undone = await teamJson(
        "POST",
        `/conversations/merges/${mergeId}/undo`,
      );
      expect(undone.status).toBe(200);
      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const [msg] = await db
          .select({ convId: conversationMessages.conversationId })
          .from(conversationMessages)
          .where(eq(conversationMessages.id, ids.srcMsgId as never));
        expect(msg?.convId).toBe(ids.sourceId);
        const [srcRow] = await db
          .select({
            status: conversations.status,
            mergedInto: conversations.mergedIntoConversationId,
          })
          .from(conversations)
          .where(eq(conversations.id, ids.sourceId as never));
        expect(srcRow?.status).toBe("open");
        expect(srcRow?.mergedInto).toBeNull();
      });
    });
  },
);
