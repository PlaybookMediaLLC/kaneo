import { ticketExternalLinks } from "../../database/quills/schema/external-links";
import { integrationEventMappings } from "../../database/quills/schema/integrations";
import { fixture, type ContractEnv } from "../framework/contract";
import { oauthConnection } from "../integrations/oauth-seed.fixture";
import { seed } from "./seed.fixture";

// Each workspace: its tickets, a GitHub connection with one channel, and a link on the ticket.
const CHANNEL = "contract:repo";
async function linkSeed(env: ContractEnv, caller: string) {
  const ids = await seed(env, caller);
  const side = async (workspaceId: string, ticketId: string) => {
    const integrationId = await oauthConnection(env, workspaceId);
    return env.scoped(workspaceId, async (db) => {
      await db.insert(integrationEventMappings).values({
        integrationId,
        eventType: "post.created",
        actionType: "send_message",
        targetKey: CHANNEL,
      });
      const [link] = await db
        .insert(ticketExternalLinks)
        .values({
          ticketId: ticketId as never,
          integrationId,
          integrationType: "github",
          externalId: `contract/repo#${Math.floor(Math.random() * 1e9)}`,
          syncScope: `seed:${CHANNEL}`,
        })
        .returning({ id: ticketExternalLinks.id });
      return { ticketId, integrationId, linkId: link!.id };
    });
  };
  return {
    a: await side(env.a, ids.a.ticketId),
    b: await side(env.b, ids.b.ticketId),
  };
}
type LinkIds = Awaited<ReturnType<typeof linkSeed>>;

export const listQuillsTicketExternalLinks = fixture({
  seed: linkSeed,
  valid: ({ a }: LinkIds) => ({ params: { ticketId: a.ticketId } }),
  foreign: ({ b }: LinkIds) => ({ ticketId: b.ticketId }),
});
export const linkQuillsTicketIssue = fixture({
  seed: linkSeed,
  valid: ({ a }: LinkIds) => ({
    params: { ticketId: a.ticketId },
    body: { integrationId: a.integrationId, issue: "contract/repo#42" },
  }),
  foreign: ({ b }: LinkIds) => ({
    ticketId: b.ticketId,
    integrationId: b.integrationId,
  }),
});
export const createQuillsTicketIssue = fixture({
  seed: linkSeed,
  valid: ({ a }: LinkIds) => ({
    params: { ticketId: a.ticketId },
    body: { integrationId: a.integrationId, target: CHANNEL },
  }),
  foreign: ({ b }: LinkIds) => ({
    ticketId: b.ticketId,
    integrationId: b.integrationId,
  }),
});
export const unlinkQuillsTicketIssue = fixture({
  seed: linkSeed,
  valid: ({ a }: LinkIds) => ({
    params: { ticketId: a.ticketId, linkId: a.linkId },
  }),
  foreign: ({ b }: LinkIds) => ({ ticketId: b.ticketId, linkId: b.linkId }),
});
