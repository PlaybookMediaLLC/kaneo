import { eq } from "drizzle-orm";
import { principal } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { conversationMessages } from "../../../database/quills/schema/conversation";
import { posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import {
  fixture,
  type ContractEnv,
  type ContractInput,
} from "../../framework/contract";
import { mintCsatToken } from "./csat-email";
import type { Customer } from "./model";
import {
  callerOf,
  conversationOf,
  enableMessenger,
  sharedRows,
  snapshotOf,
  ticketOf,
} from "./seed.fixture";

export * from "../link-preview.fixture";
export * from "../presence.fixture";

// Fixtures for the customer support routes of both audiences, the CSAT email link and the
// teammate typing routes. The presence fixtures join them, so the portal-off test finds them.

/** The caller with the surface on, its own conversation and ticket, and the shared foreign rows. */
async function world(env: ContractEnv, audience: Customer) {
  const caller = await callerOf(env, audience);
  const mine = await conversationOf(env, env.a, caller.principalId);
  const ticket = await ticketOf(
    env,
    env.a,
    caller.principalId,
    mine.conversationId,
  );
  return {
    ...caller,
    ...(await sharedRows(env)),
    mine,
    ticket,
    key: env.id("key"),
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** Never in a customer response: notes, deleted text, another customer's and workspace B's rows. */
const hidden = (w: World) => [
  w.mine.text.note,
  w.mine.text.deleted,
  w.other.text.visitor,
  w.other.text.reply,
  w.otherTicket.title,
  w.foreign.text.visitor,
  w.foreign.text.reply,
  w.foreignTicket.title,
  // The intake form: a field hidden from customers and a back-office type never show.
  w.types.hiddenLabel,
  w.types.backOfficeName,
];
/** Customer A's own values: customer B and a teammate calling as a customer must not read them. */
const own = (w: World) => [
  w.mine.text.visitor,
  w.mine.text.reply,
  w.mine.conversationId,
  w.ticket.title,
];

const customerFixture = (
  audience: Customer,
  valid: (w: World) => Omit<ContractInput, "bearer"> = () => ({}),
  foreign?: (w: World) => Record<string, string>,
) =>
  fixture({
    seed: (env) => world(env, audience),
    valid: (w: World) => ({ ...valid(w), bearer: w.bearer }),
    foreign,
    hidden,
    ...(audience === "portal" && {
      own,
      probe: (env: ContractEnv, w: World) => snapshotOf(env, w.principalId),
    }),
  });

const onConversation = (
  audience: Customer,
  extra: (w: World) => Omit<ContractInput, "bearer" | "params"> = () => ({}),
  foreign: (w: World) => Record<string, string> = () => ({}),
) =>
  customerFixture(
    audience,
    (w) => ({ params: { conversationId: w.mine.conversationId }, ...extra(w) }),
    (w) => ({ conversationId: w.foreign.conversationId, ...foreign(w) }),
  );
const onTicket = (audience: Customer) =>
  customerFixture(
    audience,
    (w) => ({ params: { ticketId: w.ticket.ticketId } }),
    (w) => ({ ticketId: w.foreignTicket.ticketId }),
  );
const message = (w: World) => ({
  body: { content: "Hello from the contract", idempotencyKey: w.key },
});

const both = <T>(make: (audience: Customer) => T) =>
  [make("widget"), make("portal")] as const;

export const [listQuillsWidgetConversations, listQuillsMyConversations] = both(
  (audience) => customerFixture(audience),
);
export const [getQuillsWidgetUnreadCount, getQuillsMyUnreadCount] = both(
  (audience) => customerFixture(audience),
);
export const [startQuillsWidgetConversation, startQuillsMyConversation] = both(
  (audience) => customerFixture(audience, message),
);
export const [getQuillsWidgetConversation, getQuillsMyConversation] = both(
  (audience) => onConversation(audience),
);
export const [
  listQuillsWidgetConversationMessages,
  listQuillsMyConversationMessages,
] = both((audience) => onConversation(audience));
export const [getQuillsWidgetConversationFile, getQuillsMyConversationFile] =
  both((audience) =>
    customerFixture(
      audience,
      (w) => ({
        params: {
          conversationId: w.mine.conversationId,
          fileId: w.mine.fileId,
        },
      }),
      (w) => ({
        conversationId: w.foreign.conversationId,
        fileId: w.foreign.fileId,
      }),
    ),
  );
export const [
  sendQuillsWidgetConversationMessage,
  sendQuillsMyConversationMessage,
] = both((audience) => onConversation(audience, message));
export const [markQuillsWidgetConversationRead, markQuillsMyConversationRead] =
  both((audience) =>
    onConversation(
      audience,
      (w) => ({ body: { throughMessageId: w.mine.replyId } }),
      (w) => ({ throughMessageId: w.foreign.replyId }),
    ),
  );
export const [
  sendQuillsWidgetConversationTyping,
  sendQuillsMyConversationTyping,
] = both((audience) => onConversation(audience));
export const [submitQuillsWidgetCsat, submitQuillsCsat] = both((audience) =>
  onConversation(audience, () => ({ body: { rating: 4, comment: "Quick" } })),
);
export const [
  handoffQuillsWidgetConversation,
  handoffQuillsPortalConversation,
] = both((audience) =>
  onConversation(audience, () => ({ body: { reason: "Need a human" } })),
);

export const [
  submitQuillsWidgetResolutionFeedback,
  submitQuillsResolutionFeedback,
] = both((audience) =>
  fixture({
    seed: async (env) => {
      const w = await world(env, audience);
      const { assistantInvolvements } =
        await import("../../../database/quills/schema/assistant");
      await env.scoped(env.a, (db) =>
        db.insert(assistantInvolvements).values({
          conversationId: w.mine.conversationId,
          triggeredBy: "first_touch",
          status: "active",
        }),
      );
      return w;
    },
    valid: (w) => ({
      bearer: w.bearer,
      params: { conversationId: w.mine.conversationId },
      body: { resolved: true },
    }),
    foreign: (w) => ({ conversationId: w.foreign.conversationId }),
    hidden,
    ...(audience === "portal" && {
      own,
      probe: (env: ContractEnv, w: World) => snapshotOf(env, w.principalId),
    }),
  }),
);

/** A post by `author` (the workspace actor when absent), as a card's confirmation names. */
const postIn = (env: ContractEnv, workspaceId: string, author?: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Contract", slug: env.id("board") })
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .limit(1);
    const [post] = await db
      .insert(posts)
      .values({
        title: "Contract card",
        content: "Contract card",
        boardId: board!.id,
        principalId: (author ?? actor.principalId) as typeof actor.principalId,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    return post!.id;
  });
/** The assistant's proposed card on the caller's reply and the caller's own post made from it. */
export const [confirmQuillsWidgetFeedbackCard, confirmQuillsFeedbackCard] =
  both((audience) =>
    fixture({
      seed: async (env) => {
        const w = await world(env, audience);
        await env.scoped(env.a, (db) =>
          db
            .update(conversationMessages)
            .set({
              metadata: {
                assistantReply: true,
                feedbackCard: {
                  title: "Dark mode",
                  body: "Add a dark theme",
                  status: "proposed",
                },
              },
            })
            .where(eq(conversationMessages.id, w.mine.replyId)),
        );
        return {
          ...w,
          postId: await postIn(env, env.a, w.principalId),
          foreignPostId: await postIn(env, env.b),
        };
      },
      valid: (w) => ({
        bearer: w.bearer,
        params: {
          conversationId: w.mine.conversationId,
          messageId: w.mine.replyId,
        },
        body: { postId: w.postId },
      }),
      foreign: (w) => ({
        conversationId: w.foreign.conversationId,
        messageId: w.foreign.replyId,
        postId: w.foreignPostId,
      }),
      hidden,
      ...(audience === "portal" && {
        own,
        probe: (env: ContractEnv, w: World) => snapshotOf(env, w.principalId),
      }),
    }),
  );

export const [getQuillsWidgetMyTickets, getQuillsMyTickets] = both((audience) =>
  customerFixture(audience),
);
export const [createQuillsWidgetMyTicket, createQuillsMyTicket] = both(
  (audience) =>
    customerFixture(
      audience,
      (w) => ({
        body: {
          title: "Cannot export",
          description: "The export spins.",
          ticketTypeId: w.types.intakeTypeId,
          fieldValues: { browser: "Firefox" },
        },
      }),
      (w) => ({ ticketTypeId: w.foreignTypes.intakeTypeId }),
    ),
);
export const [getQuillsWidgetMyTicketForm, getQuillsMyTicketForm] = both(
  (audience) => customerFixture(audience),
);
export const [
  getQuillsWidgetMyTicketStageLabels,
  getQuillsMyTicketStageLabels,
] = both((audience) => customerFixture(audience));
export const [
  getQuillsWidgetMyTicketWatchStatus,
  getQuillsMyTicketWatchStatus,
] = both((audience) => onTicket(audience));
export const [watchQuillsWidgetMyTicket, watchQuillsMyTicket] = both(
  (audience) => onTicket(audience),
);
export const [unwatchQuillsWidgetMyTicket, unwatchQuillsMyTicket] = both(
  (audience) => onTicket(audience),
);
export const [
  getQuillsWidgetConversationLinkedTicket,
  getQuillsConversationLinkedTicket,
] = both((audience) => onConversation(audience));
/** The caller's own ticket: customer B, another visitor and a teammate get unavailable. */
export const [getQuillsWidgetEmbedPreview, getQuillsEmbedPreview] = both(
  (audience) =>
    customerFixture(audience, (w) => ({
      query: { kind: "ticket", id: w.ticket.ticketId },
    })),
);

/** A fresh rating token for a new conversation of a widget visitor in A. */
const csatWorld = async (env: ContractEnv) => {
  const rows = await sharedRows(env);
  const caller = await callerOf(env, "widget");
  const mine = await conversationOf(env, env.a, caller.principalId);
  const token = await env.scoped(env.a, (db) =>
    mintCsatToken(db, mine.conversationId, caller.principalId),
  );
  return { rows, mine, token };
};
const csatHidden = (w: Awaited<ReturnType<typeof csatWorld>>) => [
  w.mine.text.note,
  w.rows.other.text.visitor,
  w.rows.foreign.text.visitor,
];

export const validateQuillsCsatEmailToken = fixture({
  seed: csatWorld,
  valid: (w) => ({ query: { token: w.token } }),
  hidden: csatHidden,
});
export const recordQuillsCsatViaToken = fixture({
  seed: csatWorld,
  valid: (w) => ({ body: { token: w.token, rating: 5 } }),
  hidden: csatHidden,
});

/** Teammate typing: a conversation in A and one in B. */
const typingFixture = fixture({
  seed: (env) => sharedRows(env),
  valid: (rows) => ({ params: { conversationId: rows.other.conversationId } }),
  foreign: (rows) => ({ conversationId: rows.foreign.conversationId }),
});
export const getQuillsConversationTyping = typingFixture;
export const sendQuillsConversationTyping = typingFixture;

/** Public messenger reads: the widget on in A; no customer name or workspace B teammate leaks. */
const publicMessenger = fixture({
  seed: async (env) => {
    await enableMessenger(env, env.a);
    const rows = await sharedRows(env);
    const outsider = await env.scoped(env.b, async (db, actor) => {
      const [row] = await db
        .select({ name: principal.displayName })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      return row?.name ?? "";
    });
    return { rows, outsider };
  },
  valid: () => ({}),
  hidden: ({ rows, outsider }) =>
    [rows.otherName, rows.other.text.visitor, outsider].filter(Boolean),
});
export const getQuillsWidgetPresence = publicMessenger;
export const listQuillsWidgetTeamAvatars = publicMessenger;
