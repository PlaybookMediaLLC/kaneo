import { postExternalLinks } from "../../database/quills/schema/external-links";
import { fixture, type ContractEnv } from "../framework/contract";
import { connection, post } from "./seed.fixture";

/** A post with a Shortcut story linked to it. */
async function side(env: ContractEnv, workspaceId: string) {
  const integration = await connection(env, workspaceId, "shortcut");
  const postId = await post(env, workspaceId);
  await env.scoped(workspaceId, (db) =>
    db.insert(postExternalLinks).values({
      postId,
      integrationId: integration.id,
      integrationType: "shortcut",
      externalId: env.id("story"),
      externalUrl: "https://app.shortcut.com/contract/story/1",
      origin: "event",
    }),
  );
  return postId;
}
const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const one = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { postId: a } }),
  foreign: ({ b }: Ids) => ({ postId: b }),
});

export const listQuillsPostExternalLinks = one;
export const retryQuillsPostIntegrationSync = one;
