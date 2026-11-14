import type { Database, QuillsActor } from "../../../database/quills/client";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import {
  tickets,
  ticketStatuses,
} from "../../../database/quills/schema/tickets";
import {
  conversationScripts,
  type ConversationScript,
} from "./conversation-content";
import { ticketScripts } from "./ticket-content";

type PrincipalId = QuillsActor["principalId"];

/** A customer's feature request in a conversation. The triage seed turns it into a signal. */
export type Request = NonNullable<ConversationScript["signal"]> & {
  conversationId: typeof conversations.$inferSelect.id;
  sourceMessageId: typeof conversationMessages.$inferSelect.id;
  principalId: PrincipalId;
  excerpt: string;
};

const HOUR = 3_600_000;
/** Each thread starts seven hours before the one before it; its messages are 20 minutes apart. */
const times = (thread: number, messages: string[]) =>
  messages.map(
    (_, message) =>
      new Date(Date.now() - (thread * 7 + 3) * HOUR + (message * HOUR) / 3),
  );
/** The customer writes first, then the turns alternate with the demo teammate. */
const turns = (
  actor: QuillsActor,
  customer: PrincipalId,
  messages: string[],
  at: Date[],
) =>
  messages.map((content, message) => ({
    principalId: message % 2 ? actor.principalId : customer,
    senderType: message % 2 ? ("agent" as const) : ("visitor" as const),
    content,
    createdAt: at[message]!,
  }));

export async function seedShowcaseSupport(
  db: Database,
  actor: QuillsActor,
  customers: PrincipalId[],
) {
  const requests: Request[] = [];
  for (const [index, script] of conversationScripts.entries()) {
    const customer = customers[index % customers.length]!;
    const at = times(index, script.messages);
    const last = script.messages.length - 1;
    const waiting = script.status === "open" && last % 2 === 0;
    const [row] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: customer,
        assignedAgentPrincipalId: script.mine ? actor.principalId : null,
        status: script.status,
        priority: script.priority ?? "none",
        channel: script.channel ?? "messenger",
        source: script.channel === "email" ? "email" : "widget",
        subject: script.subject,
        snoozedUntil:
          script.status === "snoozed"
            ? new Date(Date.now() + 7 * 24 * HOUR)
            : null,
        waitingSince: waiting ? at[last] : null,
        lastMessagePreview: script.messages[last],
        lastMessageAt: at[last],
        agentLastReadAt: waiting ? null : at[last],
        resolvedAt: script.status === "closed" ? at[last] : null,
        endReason: script.endReason ?? null,
        csatRating: script.csat ?? null,
        csatSubmittedAt: script.csat ? at[last] : null,
        createdAt: at[0],
      })
      .returning({ id: conversations.id });
    const messages = await db
      .insert(conversationMessages)
      .values(
        turns(actor, customer, script.messages, at).map((turn) => ({
          ...turn,
          conversationId: row!.id,
        })),
      )
      .returning({ id: conversationMessages.id });
    if (script.signal)
      requests.push({
        ...script.signal,
        conversationId: row!.id,
        sourceMessageId: messages[0]!.id,
        principalId: customer,
        excerpt: script.messages[0]!,
      });
  }

  const statuses = await db
    .select({
      id: ticketStatuses.id,
      slug: ticketStatuses.slug,
      category: ticketStatuses.category,
    })
    .from(ticketStatuses);
  for (const [index, script] of ticketScripts.entries()) {
    const status = statuses.find((row) => row.slug === script.status);
    if (!status)
      throw new Error(`Team showcase requires ticket status ${script.status}`);
    const customer = customers[(index * 7 + 3) % customers.length]!;
    const at = times(index + 1, script.messages);
    const [ticket] = await db
      .insert(tickets)
      .values({
        title: script.title,
        statusId: status.id,
        priority: script.priority,
        requesterPrincipalId: customer,
        assigneePrincipalId: script.mine ? actor.principalId : null,
        firstResponseAt: at[1] ?? null,
        waitingSince: at[1] ? null : at[0],
        resolvedAt: status.category === "closed" ? at.at(-1) : null,
        createdAt: at[0],
      })
      .returning({ id: tickets.id });
    await db.insert(conversationMessages).values(
      turns(actor, customer, script.messages, at).map((turn) => ({
        ...turn,
        ticketId: ticket!.id,
      })),
    );
  }
  return {
    counts: {
      conversations: conversationScripts.length,
      tickets: ticketScripts.length,
    },
    requests,
  };
}
