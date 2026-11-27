import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../../database/schema";
import { runQuillsMigrations } from "../../database/quills/migrate";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { seedSystemData } from "../../database/quills/seed-system";
import {
  agentDeclineTopics,
  aiEvalRuns,
  assistantDraftReplies,
} from "../../database/quills/schema/agent-guardrails";
import { assistantInvolvements } from "../../database/quills/schema/assistant";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { selectCustomerMessages, toMessages } from "../support/customer/model";
import { runDeterministicPolicyEval } from "./guardrails";

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

describe.skipIf(!url)(
  "AI customer agent guardrails (#299, real PostgreSQL)",
  () => {
    const wsA = `ws-agent-a-${Date.now()}`;
    const wsB = `ws-agent-b-${Date.now()}`;

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await runQuillsMigrations(
        url!,
        new URL("../../../drizzle/quills", import.meta.url).pathname,
      );
      const rootDb = drizzle(pool, { schema: kaneo });
      await rootDb.insert(kaneo.workspaceTable).values([
        {
          id: wsA,
          name: "Agent Guardrails A",
          slug: wsA,
          createdAt: new Date(),
        },
        {
          id: wsB,
          name: "Agent Guardrails B",
          slug: wsB,
          createdAt: new Date(),
        },
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

    it("seeds default decline topics idempotently and isolates workspace eval runs under RLS", async () => {
      await withQuillsSystemWorkspace(wsA, async (tx) => {
        await seedSystemData(tx);
        await seedSystemData(tx); // idempotent re-run
        const topics = await tx
          .select({
            slug: agentDeclineTopics.slug,
            policy: agentDeclineTopics.policy,
          })
          .from(agentDeclineTopics);
        const slugs = topics.map((t) => t.slug).sort();
        expect(slugs).toEqual([
          "contract_terms",
          "policies",
          "pricing",
          "refunds",
        ]);

        const evalResult = runDeterministicPolicyEval(
          topics.map((t) => ({
            slug: t.slug,
            label: t.slug,
            policy: t.policy,
            examples: [t.slug],
            enabled: true,
          })),
        );
        expect(evalResult.passed).toBe(true);
        expect(evalResult.groundingScore).toBe(1);
        expect(evalResult.escalationScore).toBe(1);
        expect(evalResult.declineScore).toBe(1);

        await tx.insert(aiEvalRuns).values({
          channel: "widget",
          model: "deterministic-replay",
          promptHash: "a".repeat(64),
          totalCases: evalResult.totalCases,
          passedCases: evalResult.passedCases,
          groundingScore: evalResult.groundingScore,
          escalationScore: evalResult.escalationScore,
          declineScore: evalResult.declineScore,
          passed: evalResult.passed,
          details: evalResult.details,
        });
      });

      // Workspace B cannot see Workspace A's eval runs under forced RLS
      await withQuillsSystemWorkspace(wsB, async (tx) => {
        const rows = await tx.select().from(aiEvalRuns);
        expect(rows).toEqual([]);
      });
    });

    it("isolates assistant_draft_replies from customer reads and exposes citations on approved messages", async () => {
      await withQuillsSystemWorkspace(wsA, async (tx) => {
        const [u] = await tx
          .insert(user)
          .values({ name: "Visitor", email: `v-${Date.now()}@example.com` })
          .returning({ id: user.id });
        const [visitor] = await tx
          .insert(principal)
          .values({
            userId: u!.id,
            type: "user",
            role: "user",
            displayName: "Visitor",
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        const [conv] = await tx
          .insert(conversations)
          .values({
            visitorPrincipalId: visitor!.id,
            channel: "messenger",
            source: "widget",
            status: "open",
            subject: "Billing question",
          })
          .returning({ id: conversations.id });

        await tx.insert(assistantInvolvements).values({
          conversationId: conv!.id,
          triggeredBy: "first_touch",
          status: "active",
        });

        await tx.insert(assistantDraftReplies).values({
          conversationId: conv!.id,
          content: "Private AI draft not yet approved by teammate",
          citations: [
            {
              type: "article",
              id: "article_test_1",
              title: "Billing Guide",
              url: "/portal/test/help/1-billing",
            },
          ],
          confidence: 0.91,
          status: "pending",
        });

        const beforeRows = await selectCustomerMessages(
          tx,
          visitor!.id,
          eq(conversationMessages.conversationId, conv!.id),
        );
        expect(toMessages(beforeRows)).toEqual([]);

        // Simulate approved cited message
        await tx.insert(conversationMessages).values({
          conversationId: conv!.id,
          principalId: null,
          senderType: "agent",
          content: "Refunds are processed within 14 days.",
          citations: [
            {
              type: "article",
              id: "article_test_1",
              title: "Billing Guide",
              url: "/portal/test/help/1-billing",
            },
          ],
          metadata: { assistantReply: true },
        });

        const afterRows = await selectCustomerMessages(
          tx,
          visitor!.id,
          eq(conversationMessages.conversationId, conv!.id),
        );
        const mapped = toMessages(afterRows);
        expect(mapped).toHaveLength(1);
        expect(mapped[0]!.fromAssistant).toBe(true);
        expect(mapped[0]!.citations).toEqual([
          {
            title: "Billing Guide",
            url: "/portal/test/help/1-billing",
            sourceType: "article",
          },
        ]);

        // Verify Workspace B cannot see Workspace A's draft replies
        const draftsInA = await tx
          .select()
          .from(assistantDraftReplies)
          .where(
            and(
              eq(assistantDraftReplies.conversationId, conv!.id),
              eq(assistantDraftReplies.status, "pending"),
            ),
          );
        expect(draftsInA).toHaveLength(1);
      });

      await withQuillsSystemWorkspace(wsB, async (tx) => {
        const draftsInB = await tx.select().from(assistantDraftReplies);
        expect(draftsInB).toEqual([]);
      });
    });
  },
);
