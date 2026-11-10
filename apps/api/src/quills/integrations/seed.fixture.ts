import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { boards } from "../../database/quills/schema/boards";
import { integrationSyncOperations } from "../../database/quills/schema/integration-sync";
import {
  integrationEventMappings,
  integrations,
} from "../../database/quills/schema/integrations";
import { posts } from "../../database/quills/schema/posts";
import { encryptSecret } from "../../notification-preferences/secrets";
import type { ContractEnv } from "../framework/contract";

// Saves seal credentials with the instance key. A configured key wins.
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-contract-test-key";

/** A fresh connection of `type` in one workspace, replacing an earlier one. */
export function connection(
  env: ContractEnv,
  workspaceId: string,
  type = "n8n",
) {
  return env.scoped(workspaceId, async (db, actor) => {
    await db.delete(integrations).where(eq(integrations.integrationType, type));
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: type,
        status: "active",
        secrets: encryptSecret(
          JSON.stringify({ url: "https://203.0.113.10/hook", apiKey: "key" }),
        )!,
        config: { workspaceName: type, account: "203.0.113.10" },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(),
      })
      .returning({
        id: integrations.id,
        connectedAt: integrations.connectedAt,
      });
    return { id: row!.id, connectedAt: row!.connectedAt! };
  });
}

/** A published post on an unlinked board. */
export function post(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Contract", slug: env.id("board") })
      .returning({ id: boards.id });
    const [row] = await db
      .insert(posts)
      .values({
        title: "Contract",
        content: "Contract",
        boardId: board!.id,
        principalId: actor.principalId,
      })
      .returning({ id: posts.id });
    return row!.id;
  });
}

/** A Shortcut connection with one channel. */
export async function channel(env: ContractEnv, workspaceId: string) {
  const { id } = await connection(env, workspaceId, "shortcut");
  const target = workspaceId === env.a ? "group-a" : "group-b";
  await env.scoped(workspaceId, (db) =>
    db.insert(integrationEventMappings).values({
      integrationId: id,
      eventType: "post.created",
      actionType: "send_message",
      targetKey: target,
    }),
  );
  return { integrationId: id, channel: target };
}

/** A failed create operation of the current n8n installation, about a visible post. */
export async function operation(env: ContractEnv, workspaceId: string) {
  const integration = await connection(env, workspaceId);
  const postId = await post(env, workspaceId);
  const [op] = await env.scoped(workspaceId, (db) =>
    db
      .insert(integrationSyncOperations)
      .values({
        operationKey: env.id("operation"),
        integrationId: integration.id,
        installation: `${integration.id}:${integration.connectedAt.toISOString()}`,
        provider: "n8n",
        direction: "outbound",
        kind: "create",
        sourceType: "post",
        sourceId: postId,
        destination: { target: "default" },
        destinationKey: "default",
        state: "failed",
        errorCode: "provider_failed",
        attempts: 1,
      })
      .returning({
        id: integrationSyncOperations.id,
        version: integrationSyncOperations.version,
      }),
  );
  return {
    integrationId: integration.id,
    syncId: op!.id,
    version: op!.version,
    key: randomUUID(),
  };
}
