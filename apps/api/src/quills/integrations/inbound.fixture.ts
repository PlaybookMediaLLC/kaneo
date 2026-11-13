import { createHmac, randomUUID } from "node:crypto";
import { createId } from "@kaneo/ids";
import { isNull } from "drizzle-orm";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { postStatuses } from "../../database/quills/schema/statuses";
import {
  fixture,
  type ContractEnv,
  type ContractInput,
} from "../framework/contract";
import { oauthConnection } from "./oauth-seed.fixture";
import { post } from "./seed.fixture";

/** A GitHub connection with status sync, and a post linked to one issue that a close maps. */
async function synced(env: ContractEnv, workspaceId: string) {
  const secret = `whsec-${workspaceId}-${randomUUID()}`;
  const [status] = await env.scoped(workspaceId, (db) =>
    db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(isNull(postStatuses.deletedAt))
      .limit(1),
  );
  const integrationId = await oauthConnection(env, workspaceId, {
    webhookSecret: secret,
    config: {
      statusMappings: { Closed: status!.id },
      statusSync: { target: "acme:app", hookId: "1", state: "active" },
    },
  });
  const postId = await post(env, workspaceId);
  const number = Math.floor(Math.random() * 1_000_000) + 1;
  await env.scoped(workspaceId, (db) =>
    db.insert(postExternalLinks).values({
      postId,
      integrationId,
      integrationType: "github",
      externalId: `acme/app#${number}`,
      origin: "event",
    }),
  );
  return { integrationId, secret, number };
}
type Synced = Awaited<ReturnType<typeof synced>>;

/** A GitHub `issues` delivery about the seeded issue, signed with `secret`. */
const delivery = (
  target: Synced,
  secret = target.secret,
  integrationId = target.integrationId,
) => {
  const raw = JSON.stringify({
    action: "closed",
    issue: { number: target.number, updated_at: new Date().toISOString() },
    repository: { full_name: "acme/app" },
  });
  return {
    params: { type: "github", integrationId },
    raw,
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": randomUUID(),
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    },
  };
};

export const receiveQuillsIntegrationWebhook = fixture({
  seed: async (env: ContractEnv) => ({
    a: await synced(env, env.a),
    b: await synced(env, env.b),
  }),
  valid: ({ a }: { a: Synced; b: Synced }) => delivery(a),
  forged: ({ a, b }: { a: Synced; b: Synced }): ContractInput[] => {
    const good = delivery(a);
    return [
      {
        ...good,
        headers: { ...good.headers, "x-hub-signature-256": "sha256=00" },
      },
      { ...good, headers: { "x-github-event": "issues" } },
      // A changed body under the original signature.
      { ...good, raw: good.raw.replace('"closed"', '"reopened"') },
      // An integration that does not exist.
      delivery(a, a.secret, createId("integration")),
      // GitLab's header scheme on a GitHub connection.
      {
        ...good,
        params: { ...good.params, type: "gitlab" },
        headers: { "x-gitlab-token": a.secret },
      },
      // B's secret on A's integration.
      delivery(a, b.secret),
    ];
  },
  crossed: ({ a, b }: { a: Synced; b: Synced }) => [
    // A's integration and issue, signed with B's secret.
    delivery(a, b.secret),
    // B's own valid delivery: it changes B only.
    delivery(b),
  ],
  // Correctly signed bodies that the schema rejects.
  invalid: ({ a }: { a: Synced; b: Synced }): ContractInput[] =>
    ['{"issue":{"number":"seven"}}', "[", '{"action":5}'].map((raw) => ({
      ...delivery(a),
      raw,
      headers: {
        "x-hub-signature-256": `sha256=${createHmac("sha256", a.secret).update(raw).digest("hex")}`,
      },
    })),
  hidden: ({ a, b }: { a: Synced; b: Synced }) => [a.secret, b.secret],
});

export { receiveQuillsAppHook } from "./slack-hook.fixture";
export { receiveQuillsIdentify } from "./identify.fixture";
