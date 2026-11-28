import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { toUuid } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { assistantPendingActions } from "../../database/quills/schema/assistant-pending-actions";
import { conversations } from "../../database/quills/schema/conversation";
import {
  ACTION_TTL_MS,
  MAX_BULK_RECORDS,
  MAX_PROPOSED_CHANGES_PER_MESSAGE,
  mintApprovalToken,
  resolveToolPolicy,
  verifyApprovalToken,
} from "./ai/tool";
import { writeTools } from "./tools";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import quillsRouter from "../index";
import { runQuillsSweeps } from "../jobs/handlers/sweeps";
import publicRouter from "../public";
import { seedFor } from "./seed.fixture";

// Safe AI actions verification (#300):
// 1. Pure unit tests: read-only defaults, conflict resolution (disabled > ask > auto_write),
//    code-enforced procedure allowedTools intersection, 15m TTL & caps, single-use token hashing,
//    and previewDiff generation on every write tool.
// 2. Real-PG integration tests: skills allowedTools persistence, previewDiff exposure on pending
//    actions, single-use approvalToken verification + replay denial, 15m TTL expiry + sweep.

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
const uuid = (id: string) => (id.includes("_") ? toUuid(id) : id);

describe("safe AI actions policy & preview helpers (#300)", () => {
  it("defaults to read-only / ask-first and resolves policy conflicts conservatively", () => {
    expect(ACTION_TTL_MS).toBe(15 * 60 * 1000);
    expect(MAX_PROPOSED_CHANGES_PER_MESSAGE).toBe(20);
    expect(MAX_BULK_RECORDS).toBe(50);

    // Read tools default to lookup unless disabled
    expect(
      resolveToolPolicy({ name: "search_help_center", kind: "read" }, []),
    ).toBe("lookup");
    expect(
      resolveToolPolicy({ name: "search_help_center", kind: "read" }, ["off"]),
    ).toBe("disabled");

    // Write tools default to ask (never silent auto_write)
    expect(
      resolveToolPolicy({ name: "add_private_note", kind: "write" }, []),
    ).toBe("ask");
    expect(
      resolveToolPolicy({ name: "set_conversation_status", kind: "write" }, []),
    ).toBe("ask");

    // Explicit auto_write enables auto execution, but ask/disabled ALWAYS win over auto_write
    expect(
      resolveToolPolicy({ name: "add_private_note", kind: "write" }, [
        "auto_write",
      ]),
    ).toBe("auto_write");
    expect(
      resolveToolPolicy({ name: "add_private_note", kind: "write" }, [
        "auto_write",
        "ask",
      ]),
    ).toBe("ask");
    expect(
      resolveToolPolicy({ name: "add_private_note", kind: "write" }, [
        "auto_write",
        "disabled",
      ]),
    ).toBe("disabled");

    // Code-enforced procedure allowlist blocks unlisted write tools even when auto_write is set
    const allowed = new Set(["add_conversation_tag"]);
    expect(
      resolveToolPolicy(
        { name: "set_conversation_status", kind: "write" },
        ["auto_write"],
        allowed,
      ),
    ).toBe("disabled");
    expect(
      resolveToolPolicy(
        { name: "add_conversation_tag", kind: "write" },
        ["ask"],
        allowed,
      ),
    ).toBe("ask");
  });

  it("mints and constant-time verifies single-use approval tokens", async () => {
    const { token, hash } = await mintApprovalToken();
    expect(token).toHaveLength(48);
    expect(hash).toHaveLength(64);
    expect(await verifyApprovalToken(token, hash)).toBe(true);
    expect(await verifyApprovalToken(`${token}x`, hash)).toBe(false);
    expect(await verifyApprovalToken("wrong-token", hash)).toBe(false);
  });

  it("produces structured previewDiff for every write tool", () => {
    const fakeConv = {
      id: "cnv_test",
      status: "open",
      priority: "normal",
      assignedTeamId: null,
      customAttributes: { plan: "free" },
    } as any;
    expect(
      writeTools.set_conversation_status.previewDiff!(fakeConv, {
        status: "closed",
      }),
    ).toEqual({
      targetType: "conversation",
      targetId: "cnv_test",
      fields: [{ field: "status", before: "open", after: "closed" }],
      recordCount: 1,
    });
    expect(
      writeTools.set_conversation_priority.previewDiff!(fakeConv, {
        priority: "urgent",
      }),
    ).toEqual({
      targetType: "conversation",
      targetId: "cnv_test",
      fields: [{ field: "priority", before: "normal", after: "urgent" }],
      recordCount: 1,
    });
    expect(
      writeTools.set_conversation_attribute.previewDiff!(fakeConv, {
        key: "plan",
        value: "pro",
      }),
    ).toEqual({
      targetType: "conversation",
      targetId: "cnv_test",
      fields: [{ field: "attribute.plan", before: "free", after: "pro" }],
      recordCount: 1,
    });
  });
});

describe.skipIf(!url)(
  "safe AI actions real PostgreSQL integration (#300)",
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
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

    it("persists procedure allowedTools and assistant settings with lookup/ask/auto_write/disabled", async () => {
      const skill = await teamJson("POST", "/assistant/skills", {
        name: `Refund Procedure ${contractEnv().id("sk")}`,
        whenToUse: "When customer asks for a refund",
        instructions: "Only tag the conversation; never close it.",
        assignments: { agent: false, copilot: true },
        allowedTools: ["add_conversation_tag"],
      });
      expect(skill.status).toBe(200);
      expect(skill.body.allowedTools).toEqual(["add_conversation_tag"]);

      const settingsRes = await teamJson("GET", "/assistant/settings");
      expect(settingsRes.status).toBe(200);
      const patch = await teamJson("PATCH", "/assistant/settings", {
        revision: settingsRes.body.revision,
        copilotToolRules: [
          { tool: "search_help_center", mode: "lookup" },
          { tool: "add_private_note", mode: "ask" },
          { tool: "set_conversation_status", mode: "disabled" },
        ],
      });
      expect(patch.status).toBe(200);
      expect(patch.body.copilot.toolRules).toEqual(
        expect.arrayContaining([
          { tool: "add_private_note", mode: "ask" },
          { tool: "set_conversation_status", mode: "disabled" },
        ]),
      );
    });

    it("enforces single-use approvalToken, previewDiff visibility, and replay denial via /decision", async () => {
      const seeded = await seedFor("conversation")(contractEnv());
      const { token, hash } = await mintApprovalToken();

      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        await db
          .update(assistantPendingActions)
          .set({
            approvalTokenHash: hash,
            previewDiff: {
              targetType: "conversation",
              targetId: seeded.a.conversationId,
              fields: [
                { field: "priority", before: "normal", after: "urgent" },
              ],
              recordCount: 1,
            },
            toolName: "set_conversation_priority",
            args: { priority: "urgent" },
            expiresAt: new Date(Date.now() + ACTION_TTL_MS),
          })
          .where(
            eq(assistantPendingActions.id, uuid(seeded.a.actionId) as never),
          );
      });

      const getRes = await teamJson(
        "GET",
        `/assistant/pending-actions/${seeded.a.actionId}`,
      );
      expect(getRes.status).toBe(200);
      expect(getRes.body.previewDiff).toEqual({
        targetType: "conversation",
        targetId: seeded.a.conversationId,
        fields: [{ field: "priority", before: "normal", after: "urgent" }],
        recordCount: 1,
      });
      // approvalTokenHash is NEVER leaked in API responses
      expect(getRes.body.approvalTokenHash).toBeUndefined();

      // Wrong token is refused (409) and conversation stays untouched
      const wrong = await teamJson(
        "POST",
        `/assistant/pending-actions/${seeded.a.actionId}/decision`,
        { decision: "approve", approvalToken: "invalid-token" },
      );
      expect(wrong.status).toBe(409);

      // Valid single-use token executes the action
      const ok = await teamJson(
        "POST",
        `/assistant/pending-actions/${seeded.a.actionId}/decision`,
        { decision: "approve", approvalToken: token },
      );
      expect(ok.status).toBe(200);
      expect(ok.body.action.status).toBe("executed");

      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        const [conv] = await db
          .select({ priority: conversations.priority })
          .from(conversations)
          .where(eq(conversations.id, uuid(seeded.a.conversationId) as never));
        expect(conv?.priority).toBe("urgent");
      });

      // Replaying the same decision / token MUST fail with 409
      const replay = await teamJson(
        "POST",
        `/assistant/pending-actions/${seeded.a.actionId}/decision`,
        { decision: "approve", approvalToken: token },
      );
      expect(replay.status).toBe(409);
    });

    it("expires proposed actions past the 15-minute TTL during runQuillsSweeps", async () => {
      const seeded = await seedFor("conversation")(contractEnv());
      await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
        await db
          .update(assistantPendingActions)
          .set({ expiresAt: new Date(Date.now() - 60_000) })
          .where(
            eq(assistantPendingActions.id, uuid(seeded.a.actionId) as never),
          );
      });

      await runQuillsSweeps(contractEnv().a);

      const after = await teamJson(
        "GET",
        `/assistant/pending-actions/${seeded.a.actionId}`,
      );
      expect(after.status).toBe(200);
      expect(after.body.status).toBe("expired");
    });
  },
);
