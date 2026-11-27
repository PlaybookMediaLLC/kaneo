import { requestAccessLinks } from "../../database/quills/schema/conversation";
import { fixture } from "../framework/contract";
import { mintRequestLinkToken } from "../framework/request-magic-link";
import { onConversation, seeded, type Ids } from "./conversation-seed.fixture";

export const listQuillsConversationAccessLinks = onConversation();
export const createQuillsConversationAccessLink = onConversation(() => ({
  body: { ttlDays: 30 },
}));
export const revokeAllQuillsConversationAccessLinks = onConversation();

const seedLink = async (
  env: Parameters<ReturnType<typeof seeded>>[0],
  caller: string,
) => {
  const ids = await seeded()(env, caller);
  const insert = async (
    workspaceId: string,
    conversationId: string,
    principalId: string,
  ) => {
    const minted = mintRequestLinkToken({
      workspaceId,
      resourceType: "conversation",
      resourceId: conversationId,
      principalId,
    });
    const [row] = await env.scoped(workspaceId, (db) =>
      db
        .insert(requestAccessLinks)
        .values({
          tokenHash: minted.tokenHash,
          resourceType: "conversation",
          resourceId: conversationId,
          principalId:
            principalId as typeof requestAccessLinks.$inferInsert.principalId,
          expiresAt: minted.expiresAt,
        })
        .returning({ id: requestAccessLinks.id }),
    );
    return row!.id;
  };
  return {
    ...ids,
    linkA: await insert(env.a, ids.a.conversationId, ids.a.visitorId),
    linkB: await insert(env.b, ids.b.conversationId, ids.b.visitorId),
  };
};

export const revokeQuillsAccessLink = fixture({
  seed: seedLink,
  valid: (ids: Ids & { linkA: string; linkB: string }) => ({
    params: { linkId: ids.linkA },
  }),
  foreign: (ids: Ids & { linkA: string; linkB: string }) => ({
    linkId: ids.linkB,
  }),
});
