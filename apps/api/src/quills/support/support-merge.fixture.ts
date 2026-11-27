import { conversations } from "../../database/quills/schema/conversation";
import { supportMergeRecords } from "../../database/quills/schema/support-merges";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
import { fixture, type ContractEnv } from "../framework/contract";
import { seed as seedConv } from "./conversation-seed.fixture";

async function seedMerges(env: ContractEnv, caller: string) {
  const base = await seedConv(env, caller);
  const extra = async (ws: string, visitorId: string, baseConvId: string) =>
    env.scoped(ws, async (db) => {
      const [c2] = await db
        .insert(conversations)
        .values({
          visitorPrincipalId: visitorId as never,
          channel: "messenger",
          source: "widget",
          status: "open",
          subject: "Duplicate thread",
        })
        .returning({ id: conversations.id });
      const [cm] = await db
        .insert(supportMergeRecords)
        .values({
          entityKind: "conversation",
          sourceId: c2!.id,
          targetId: baseConvId,
          snapshot: {
            movedMessageIds: [],
            sourceBefore: { status: "open", resolvedAt: null },
          },
        })
        .returning({ id: supportMergeRecords.id });
      const [st] = await db
        .insert(ticketStatuses)
        .values({
          name: `Open ${env.id("st")}`,
          slug: `open-${env.id("st")}`,
          category: "open",
        })
        .returning({ id: ticketStatuses.id });
      const [t1] = await db
        .insert(tickets)
        .values({
          title: "Target ticket",
          statusId: st!.id,
          requesterPrincipalId: visitorId as never,
        })
        .returning({ id: tickets.id });
      const [t2] = await db
        .insert(tickets)
        .values({
          title: "Source ticket",
          statusId: st!.id,
          requesterPrincipalId: visitorId as never,
        })
        .returning({ id: tickets.id });
      const [tm] = await db
        .insert(supportMergeRecords)
        .values({
          entityKind: "ticket",
          sourceId: t2!.id,
          targetId: t1!.id,
          snapshot: {
            movedMessageIds: [],
            sourceBefore: {
              status: "active",
              statusId: st!.id,
              resolvedAt: null,
            },
          },
        })
        .returning({ id: supportMergeRecords.id });
      return {
        targetConvId: baseConvId,
        sourceConvId: c2!.id,
        convMergeId: cm!.id,
        targetTicketId: t1!.id,
        sourceTicketId: t2!.id,
        ticketMergeId: tm!.id,
      };
    });
  return {
    a: await extra(env.a, base.a.visitorId, base.a.conversationId),
    b: await extra(env.b, base.b.visitorId, base.b.conversationId),
  };
}

export const previewQuillsConversationMerge = fixture({
  seed: seedMerges,
  valid: (ids) => ({
    body: {
      sourceConversationIds: [ids.a.sourceConvId],
      targetConversationId: ids.a.targetConvId,
    },
  }),
  foreign: (ids) => ({ targetConversationId: ids.b.targetConvId }),
});

export const mergeQuillsConversations = fixture({
  seed: seedMerges,
  valid: (ids) => ({
    body: {
      sourceConversationIds: [ids.a.sourceConvId],
      targetConversationId: ids.a.targetConvId,
    },
  }),
  foreign: (ids) => ({ targetConversationId: ids.b.targetConvId }),
});

export const undoQuillsConversationMerge = fixture({
  seed: seedMerges,
  valid: (ids) => ({ params: { mergeId: ids.a.convMergeId } }),
  foreign: (ids) => ({ mergeId: ids.b.convMergeId }),
});

export const previewQuillsTicketMerge = fixture({
  seed: seedMerges,
  valid: (ids) => ({
    body: {
      sourceTicketIds: [ids.a.sourceTicketId],
      targetTicketId: ids.a.targetTicketId,
    },
  }),
  foreign: (ids) => ({ targetTicketId: ids.b.targetTicketId }),
});

export const mergeQuillsTickets = fixture({
  seed: seedMerges,
  valid: (ids) => ({
    body: {
      sourceTicketIds: [ids.a.sourceTicketId],
      targetTicketId: ids.a.targetTicketId,
    },
  }),
  foreign: (ids) => ({ targetTicketId: ids.b.targetTicketId }),
});

export const undoQuillsTicketMerge = fixture({
  seed: seedMerges,
  valid: (ids) => ({ params: { mergeId: ids.a.ticketMergeId } }),
  foreign: (ids) => ({ mergeId: ids.b.ticketMergeId }),
});
