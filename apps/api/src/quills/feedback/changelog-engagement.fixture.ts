import { changelogEntries } from "../../database/quills/schema/changelog";
import { changelogReactions } from "../../database/quills/schema/changelog-engagement";
import { fixture, type ContractEnv } from "../framework/contract";

/** A published entry with one reaction, in one workspace. */
const engagedEntry = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [entry] = await db
      .insert(changelogEntries)
      .values({
        title: env.id("entry"),
        content: "Shipped",
        publishedAt: new Date(Date.now() - 60_000),
      })
      .returning({ id: changelogEntries.id });
    await db.insert(changelogReactions).values({
      changelogEntryId: entry!.id,
      principalId: actor.principalId,
      emoji: "🎉",
    });
    return entry!.id;
  });

export const listQuillsChangelogEngagement = fixture({
  seed: async (env) => ({
    a: await engagedEntry(env, env.a),
    b: await engagedEntry(env, env.b),
  }),
  valid: () => ({}),
});
