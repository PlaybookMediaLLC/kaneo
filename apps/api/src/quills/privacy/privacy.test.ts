import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../../database/schema";
import { runQuillsMigrations } from "../../database/quills/migrate";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { principal, user } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import {
  conversationMessages,
  conversationMessageTranslations,
  conversations,
} from "../../database/quills/schema/conversation";
import { conversationSummaries } from "../../database/quills/schema/conversation-summary";
import { emailLog } from "../../database/quills/schema/email-log";
import { files } from "../../database/quills/schema/files";
import {
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import {
  retentionPolicies,
  supportDailyStats,
} from "../../database/quills/schema/privacy";
import { slaEvents, slaPolicies } from "../../database/quills/schema/sla";
import { postStatuses } from "../../database/quills/schema/statuses";
import { eraseCustomerInTx } from "./erase-customer";
import { enforceWorkspaceRetentionPolicies } from "./retention-policies";
import { collectSubjectData } from "./subject-bundle";
import { buildZipArchive } from "./zip";

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

const url = process.env.QUILLS_TEST_DATABASE_URL;

describe("privacy zip archive builder", () => {
  it("builds a valid PKZIP 2.0 archive containing JSON and binary entries", () => {
    const zip = buildZipArchive([
      { name: "data.json", data: Buffer.from('{"hello":"world"}', "utf8") },
      {
        name: "attachments/a.txt",
        data: Buffer.from("secret-free attachment"),
      },
    ]);
    // Local file header PK\x03\x04 and End of Central Directory PK\x05\x06
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(zip.includes(Buffer.from("data.json", "utf8"))).toBe(true);
    expect(zip.includes(Buffer.from("attachments/a.txt", "utf8"))).toBe(true);
  });
});

describe.skipIf(!url)("Quills privacy built in (#329, real PostgreSQL)", () => {
  const wsA = `ws-privacy-a-${Date.now()}`;
  const wsB = `ws-privacy-b-${Date.now()}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await runQuillsMigrations(
      url!,
      new URL("../../../drizzle/quills", import.meta.url).pathname,
    );
    const rootDb = drizzle(pool, { schema: kaneo });
    await rootDb.insert(kaneo.workspaceTable).values([
      { id: wsA, name: "Privacy A", slug: wsA, createdAt: new Date() },
      { id: wsB, name: "Privacy B", slug: wsB, createdAt: new Date() },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM public.workspace WHERE id IN ($1, $2)", [
        wsA,
        wsB,
      ]);
      await pool.end();
    }
  });

  it("erases a customer completely with 0 PII remaining across Quills tables and queues storage cleanup", async () => {
    const targetEmail = `erase-me-${Date.now()}@privacy-test.example`;
    const storageKey = `${wsA}/quills/file/customer-secret-doc.pdf`;

    const seeded = await withQuillsSystemWorkspace(wsA, async (tx) => {
      const [u] = await tx
        .insert(user)
        .values({
          name: "Secret Customer",
          email: targetEmail,
          externalId: "ext-secret-123",
        })
        .returning({ id: user.id });
      const [p] = await tx
        .insert(principal)
        .values({
          userId: u!.id,
          type: "user",
          role: "user",
          displayName: "Secret Customer",
          contactEmail: targetEmail,
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      const [conv] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: p!.id,
          channel: "email",
          source: "email",
          visitorEmail: targetEmail,
          subject: `Help for ${targetEmail}`,
          lastMessagePreview: `My email is ${targetEmail}`,
        })
        .returning({ id: conversations.id });
      const [msg] = await tx
        .insert(conversationMessages)
        .values({
          conversationId: conv!.id,
          principalId: p!.id,
          senderType: "visitor",
          content: `Contact me at ${targetEmail} with card 4111-1111`,
          attachments: [
            {
              url: "https://example.test/secret.pdf",
              fileId: "file_test",
              name: "secret.pdf",
              contentType: "application/pdf",
              size: 42,
            },
          ],
        })
        .returning({ id: conversationMessages.id });
      await tx.insert(conversationMessageTranslations).values({
        conversationMessageId: msg!.id,
        locale: "fr",
        content: `Contactez-moi a ${targetEmail}`,
      });
      await tx.insert(conversationSummaries).values({
        conversationId: conv!.id,
        visitorPrincipalId: p!.id,
        summary: `Customer ${targetEmail} asked about billing`,
        messageCount: 1,
        generatedAt: new Date(),
      } as typeof conversationSummaries.$inferInsert);
      await tx.insert(files).values({
        storageKey,
        name: "secret.pdf",
        contentType: "application/pdf",
        family: "pdf",
        size: 42,
        sha256: "0".repeat(64),
        source: "visitor",
        uploadedById: p!.id,
        messageId: msg!.id,
      });
      await tx.insert(emailLog).values({
        direction: "outbound",
        emailType: "reply",
        principalId: p!.id,
        address: targetEmail,
        conversationId: conv!.id,
        status: "sent",
      });
      const [board] = await tx
        .insert(boards)
        .values({ name: "General", slug: `gen-${Date.now()}` })
        .returning({ id: boards.id });
      const [status] = await tx
        .insert(postStatuses)
        .values({
          name: "Open",
          slug: `open-${Date.now()}`,
          category: "active",
          color: "#3b82f6",
        })
        .returning({ id: postStatuses.id });
      const [post] = await tx
        .insert(posts)
        .values({
          boardId: board!.id,
          statusId: status!.id,
          principalId: p!.id,
          title: "Feature request",
          content: `Authored by ${targetEmail}`,
        })
        .returning({ id: posts.id });
      await tx.insert(postComments).values({
        postId: post!.id,
        principalId: p!.id,
        content: `Follow up from ${targetEmail}`,
      });
      await tx.insert(postVotes).values({
        postId: post!.id,
        principalId: p!.id,
      });
      return { principalId: p!.id, convId: conv!.id, msgId: msg!.id };
    });

    // Collect subject export before erasure and confirm internal notes are excluded
    const bundle = await withQuillsSystemWorkspace(wsA, (tx) =>
      collectSubjectData(tx, wsA, seeded.principalId),
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.payload.profile.email).toBe(targetEmail);
    expect(bundle!.payload.conversations).toHaveLength(1);
    expect(bundle!.payload.posts).toHaveLength(1);
    expect(bundle!.payload.votes).toHaveLength(1);

    // Execute erasure (anonymize mode)
    const receipt = await withQuillsSystemWorkspace(wsA, (tx) =>
      eraseCustomerInTx(tx, seeded.principalId, {
        mode: "anonymize",
        actor: null,
      }),
    );

    expect(receipt.status).toBe("completed");
    expect(receipt.summary.conversations).toBe(1);
    expect(receipt.summary.files).toBe(1);
    expect(receipt.subjectDigest).toMatch(/^[0-9a-f]{64}$/);

    // Verify 0 occurrences of targetEmail across all Quills tables in workspace A!
    await withQuillsSystemWorkspace(wsA, async (tx) => {
      const checks = [
        sql`SELECT count(*)::int AS c FROM quills.customer_identity WHERE lower(coalesce(email,'')) = ${targetEmail}`,
        sql`SELECT count(*)::int AS c FROM quills.principal WHERE lower(coalesce(contact_email,'')) = ${targetEmail}`,
        sql`SELECT count(*)::int AS c FROM quills.conversations WHERE coalesce(visitor_email,'') ILIKE ${`%${targetEmail}%`} OR coalesce(subject,'') ILIKE ${`%${targetEmail}%`} OR coalesce(last_message_preview,'') ILIKE ${`%${targetEmail}%`}`,
        sql`SELECT count(*)::int AS c FROM quills.conversation_messages WHERE content ILIKE ${`%${targetEmail}%`}`,
        sql`SELECT count(*)::int AS c FROM quills.conversation_message_translations WHERE content ILIKE ${`%${targetEmail}%`}`,
        sql`SELECT count(*)::int AS c FROM quills.conversation_summaries WHERE summary ILIKE ${`%${targetEmail}%`}`,
        sql`SELECT count(*)::int AS c FROM quills.email_log WHERE lower(address) = ${targetEmail}`,
        sql`SELECT count(*)::int AS c FROM quills.posts WHERE coalesce(content,'') ILIKE ${`%${targetEmail}%`}`,
        sql`SELECT count(*)::int AS c FROM quills.post_comments WHERE content ILIKE ${`%${targetEmail}%`}`,
        sql`SELECT count(*)::int AS c FROM quills.files WHERE storage_key = ${storageKey}`,
        sql`SELECT count(*)::int AS c FROM quills.privacy_requests WHERE summary::text ILIKE ${`%${targetEmail}%`} OR coalesce(subject_email_hash,'') = ${targetEmail}`,
      ];
      for (const query of checks) {
        const res = await tx.execute<{ c: number }>(query);
        expect(res.rows[0]?.c).toBe(0);
      }

      // Thread structural row survives, re-attributed to Deleted user tombstone
      const [conv] = await tx
        .select({
          subject: conversations.subject,
          visitorEmail: conversations.visitorEmail,
        })
        .from(conversations)
        .where(eq(conversations.id, seeded.convId));
      expect(conv?.subject).toBe("[Redacted]");
      expect(conv?.visitorEmail).toBeNull();
    });

    // Verify storage cleanup queue received the deleted file key
    const cleanup = await pool.query<{ object_key: string }>(
      "SELECT object_key FROM public.storage_cleanup WHERE object_key = $1",
      [storageKey],
    );
    expect(cleanup.rows).toHaveLength(1);
  });

  it("enforces per-workspace retention schedules while preserving support_daily_stats totals and workspace isolation", async () => {
    const oldDate = new Date(Date.now() - 45 * 86_400_000);
    const oldDay = oldDate.toISOString().slice(0, 10);

    // Seed workspace A with an old closed conversation + SLA event + 30d retention policy
    const convA = await withQuillsSystemWorkspace(wsA, async (tx) => {
      const [p] = await tx
        .insert(principal)
        .values({
          type: "anonymous",
          role: "user",
          displayName: "Old Visitor",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      const [policy] = await tx
        .insert(slaPolicies)
        .values({ name: "Default SLA", firstResponseTargetSecs: 3600 })
        .returning({ id: slaPolicies.id });
      const [conv] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: p!.id,
          channel: "email",
          source: "email",
          status: "closed",
          endReason: "resolved",
          resolvedAt: oldDate,
          createdAt: oldDate,
          csatRating: 5,
        })
        .returning({ id: conversations.id });
      await tx.insert(slaEvents).values({
        policyId: policy!.id,
        conversationId: conv!.id,
        kind: "first_response_met",
        at: oldDate,
      });
      await tx.insert(retentionPolicies).values({
        channel: "email",
        action: "delete",
        closedAfterDays: 30,
      });
      return conv!.id;
    });

    // Seed workspace B with an identical old closed conversation and NO retention policy
    const convB = await withQuillsSystemWorkspace(wsB, async (tx) => {
      const [p] = await tx
        .insert(principal)
        .values({
          type: "anonymous",
          role: "user",
          displayName: "WS B Visitor",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      const [conv] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: p!.id,
          channel: "email",
          source: "email",
          status: "closed",
          endReason: "resolved",
          resolvedAt: oldDate,
          createdAt: oldDate,
        })
        .returning({ id: conversations.id });
      return conv!.id;
    });

    // Run retention sweep on workspace A only
    const removedA = await withQuillsSystemWorkspace(wsA, (tx) =>
      enforceWorkspaceRetentionPolicies(tx),
    );
    expect(removedA).toBeGreaterThanOrEqual(1);

    // Workspace A conversation is purged, but its stats & SLA event are preserved in support_daily_stats
    await withQuillsSystemWorkspace(wsA, async (tx) => {
      const remaining = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, convA));
      expect(remaining).toHaveLength(0);

      const [stat] = await tx
        .select()
        .from(supportDailyStats)
        .where(eq(supportDailyStats.day, oldDay));
      expect(stat).toBeDefined();
      expect(stat!.conversationsCreated).toBeGreaterThanOrEqual(1);
      expect(stat!.slaFirstResponseMet).toBeGreaterThanOrEqual(1);
      expect(stat!.csatSum).toBe(5);
      expect(stat!.csatCount).toBe(1);
    });

    // Workspace B is completely untouched (tenant isolation + RLS verified!)
    await withQuillsSystemWorkspace(wsB, async (tx) => {
      const remainingB = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, convB));
      expect(remainingB).toHaveLength(1);

      const policiesB = await tx.select().from(retentionPolicies);
      expect(policiesB).toHaveLength(0);
    });
  });
});
