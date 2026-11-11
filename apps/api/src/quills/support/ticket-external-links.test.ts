import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { integrationSyncOperations } from "../../database/quills/schema/integration-sync";
import { integrationEventMappings } from "../../database/quills/schema/integrations";
import * as kaneo from "../../database/schema";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import quillsRouter from "../index";
import { oauthConnection } from "../integrations/oauth-seed.fixture";
import {
  providerCalls,
  providerOverrides,
} from "../integrations/provider-edge.fixture";
import { drainQuillsWorkspace } from "../jobs/worker";

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
const app = contractApp(quillsRouter);

async function call(
  method: string,
  path: string,
  body?: unknown,
  workspace?: string,
) {
  const env = contractEnv();
  const res = await app.request(`/quills/${workspace ?? env.a}${path}`, {
    method,
    headers: {
      "x-test-user": env.owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
/** A GitHub connection with the channel `acme:app`. */
async function connection(workspaceId: string) {
  const env = contractEnv();
  const integrationId = await oauthConnection(env, workspaceId);
  await env.scoped(workspaceId, (db) =>
    db.insert(integrationEventMappings).values({
      integrationId,
      eventType: "post.created",
      actionType: "send_message",
      targetKey: "acme:app",
    }),
  );
  return integrationId;
}
const drain = async () => {
  await drainQuillsWorkspace(contractEnv().a, async () => {});
  await drainQuillsWorkspace(contractEnv().a, async () => {});
};
const issueCalls = () =>
  providerCalls.filter(
    (c) =>
      c.method === "POST" && c.path === "/api.github.com/repos/acme/app/issues",
  );

describe.skipIf(!url)("Ticket tracker issue links", () => {
  beforeAll(async () => {
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
      "quills-contract-test-key";
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("links, creates and unlinks issues in this workspace's channels only", async () => {
    const env = contractEnv();
    const integrationId = await connection(env.a);
    const foreignIntegration = await connection(env.b);
    const ticket = await call("POST", "/tickets", {
      type: "back_office",
      title: "Exports time out",
      description: "Large exports fail after 30 seconds",
    });
    expect(ticket.status).toBe(200);
    const path = `/tickets/${ticket.body.id}/external-links`;

    const linked = await call("PUT", path, {
      integrationId,
      issue: "https://github.com/acme/app/issues/12",
    });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      externalId: "acme/app#12",
      externalUrl: "https://github.com/acme/app/issues/12",
      changed: true,
    });
    expect(
      (await call("PUT", path, { integrationId, issue: "acme/app#12" })).body,
    ).toMatchObject({ id: linked.body.id, changed: false });
    // Another repository, or workspace B's connection, never links.
    expect(
      (await call("PUT", path, { integrationId, issue: "other/repo#1" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("PUT", path, {
          integrationId: foreignIntegration,
          issue: "acme/app#13",
        })
      ).status,
    ).toBe(404);
    // The note stays on the team's side of the thread.
    const notes = await env.scoped(env.a, (db) =>
      db
        .select({ isInternal: conversationMessages.isInternal })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.ticketId, ticket.body.id),
            eq(conversationMessages.senderType, "system"),
          ),
        ),
    );
    expect(notes).toEqual([{ isInternal: true }]);

    // Create: queued in the request, sent once after commit, then linked. A team note stays out
    // of the issue: a tracker can be public.
    await call("POST", `/tickets/${ticket.body.id}/note`, {
      content: "SecretNoteMarker",
    });
    providerCalls.length = 0;
    const created = await call("POST", `${path}/issue`, {
      integrationId,
      target: "acme:app",
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ state: "queued", changed: true });
    expect(issueCalls()).toHaveLength(0);
    await drain();
    expect(issueCalls()).toHaveLength(1);
    expect(JSON.parse(issueCalls()[0]!.body)).toMatchObject({
      title: "Exports time out",
    });
    expect(issueCalls()[0]!.body).toContain("Large exports fail");
    expect(issueCalls()[0]!.body).not.toContain("SecretNoteMarker");
    const again = await call("POST", `${path}/issue`, {
      integrationId,
      target: "acme:app",
    });
    expect(again.body).toMatchObject({
      operationId: created.body.operationId,
      changed: false,
    });
    await drain();
    expect(issueCalls()).toHaveLength(1);
    const listed = await call("GET", path);
    expect(
      listed.body.links.map((l: { externalId: string }) => l.externalId),
    ).toEqual(["acme/app#12", "acme/app#7"]);
    expect(listed.body.trackers).toEqual([
      {
        integrationId,
        integrationType: "github",
        name: "GitHub",
        channels: ["acme:app"],
      },
    ]);
    expect(
      (
        await call("POST", `${path}/issue`, {
          integrationId,
          target: "acme:other",
        })
      ).status,
    ).toBe(400);

    // A path in workspace B is not this caller's: refused before any read.
    expect([403, 404]).toContain(
      (await call("GET", path, undefined, env.b)).status,
    );

    // Another ticket's path never removes this ticket's link.
    const other = await call("POST", "/tickets", {
      type: "back_office",
      title: "Unrelated",
    });
    expect(
      (
        await call(
          "DELETE",
          `/tickets/${other.body.id}/external-links/${linked.body.id}`,
        )
      ).status,
    ).toBe(404);
    const removed = await call("DELETE", `${path}/${linked.body.id}`);
    expect(removed.body).toEqual({ changed: true });
    expect((await call("DELETE", `${path}/${linked.body.id}`)).status).toBe(
      404,
    );
    expect(
      (await call("GET", path)).body.links.map(
        (l: { externalId: string }) => l.externalId,
      ),
    ).toEqual(["acme/app#7"]);
  });

  it("never sends an uncertain create again and links nothing for it", async () => {
    const env = contractEnv();
    const integrationId = await connection(env.a);
    const ticket = await call("POST", "/tickets", {
      type: "back_office",
      title: "Uncertain create",
    });
    providerCalls.length = 0;
    providerOverrides.set("POST /api.github.com/repos/acme/app/issues", "drop");
    try {
      const created = await call(
        "POST",
        `/tickets/${ticket.body.id}/external-links/issue`,
        { integrationId, target: "acme:app" },
      );
      await drain();
      await drain();
      expect(issueCalls()).toHaveLength(1);
      const [op] = await env.scoped(env.a, (db) =>
        db
          .select({ state: integrationSyncOperations.state })
          .from(integrationSyncOperations)
          .where(eq(integrationSyncOperations.id, created.body.operationId)),
      );
      expect(op!.state).toBe("uncertain");
      expect(
        (await call("GET", `/tickets/${ticket.body.id}/external-links`)).body
          .links,
      ).toEqual([]);
    } finally {
      providerOverrides.clear();
    }
  });
});
