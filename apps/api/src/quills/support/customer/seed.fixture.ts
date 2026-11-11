import { and, asc, eq, isNull } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { ticketSubscriptions } from "../../../database/quills/schema/ticket-subscriptions";
import { ticketTypes } from "../../../database/quills/schema/ticket-types";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../../database/quills/schema/tickets";
import type { ContractEnv } from "../../framework/contract";
import { enablePortal } from "../../portal/customer-seed.fixture";
import type { Customer } from "./model";

// Seed helpers for the customer support fixtures and tests. Not fixtures themselves.

/** A unique text that is never a substring of another: label_3 would be inside label_31. */
const unique = (env: ContractEnv, label: string) => `${env.id(label)}x`;

type PrincipalId = TypeId<"principal">;
type ConversationId = TypeId<"conversation">;

/** Turns the widget on with its messenger and tickets tabs, keeping a signing secret that is already set. */
export const enableMessenger = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .select({ widgetSecret: settings.widgetSecret })
      .from(settings);
    await db.update(settings).set({
      widgetConfig: JSON.stringify({
        enabled: true,
        tabs: { messenger: true, tickets: true },
      }),
      widgetSecret: row?.widgetSecret ?? `wgt_${env.id("secret")}`,
    });
  });

/** A widget-only customer (no Kaneo account) in a workspace. */
export const plainCustomer = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const label = unique(env, "customer");
    const [identity] = await db
      .insert(customer)
      .values({ name: label, email: `${label}@example.test` })
      .returning({ id: customer.id });
    const [person] = await db
      .insert(principal)
      .values({
        userId: identity!.id,
        role: "user",
        type: "user",
        displayName: label,
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    return { principalId: person!.id, name: label };
  });

/**
 * A conversation of `visitor` with a visitor message, a teammate reply, an internal note and a
 * deleted message. Each text is unique, so a response that leaks one is found.
 */
export const conversationOf = (
  env: ContractEnv,
  workspaceId: string,
  visitor: PrincipalId,
  channel: "messenger" | "email" = "messenger",
) =>
  env.scoped(workspaceId, async (db, actor) => {
    const text = {
      visitor: unique(env, "visitor_says"),
      reply: unique(env, "team_replies"),
      note: unique(env, "internal_note"),
      deleted: unique(env, "deleted_text"),
    };
    const start = Date.now() - 60_000;
    const [conversation] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: visitor,
        channel,
        status: "open",
        subject: text.visitor,
        lastMessagePreview: text.reply,
        lastMessageAt: new Date(start + 3000),
        visitorEmail:
          channel === "email" ? `${env.id("mail")}@example.test` : null,
      })
      .returning({ id: conversations.id });
    const id = conversation!.id;
    const insert = (
      at: number,
      values: Partial<typeof conversationMessages.$inferInsert>,
    ) =>
      db
        .insert(conversationMessages)
        .values({
          conversationId: id,
          senderType: "agent",
          content: "",
          createdAt: new Date(start + at),
          ...values,
        })
        .returning({ id: conversationMessages.id })
        .then((rows) => rows[0]!.id);
    const visitorMessageId = await insert(1000, {
      principalId: visitor,
      senderType: "visitor",
      content: text.visitor,
    });
    const replyId = await insert(2000, {
      principalId: actor.principalId,
      content: text.reply,
    });
    const noteId = await insert(2500, {
      principalId: actor.principalId,
      isInternal: true,
      content: text.note,
    });
    await insert(2800, {
      principalId: actor.principalId,
      content: text.deleted,
      deletedAt: new Date(),
    });
    return { conversationId: id, visitorMessageId, replyId, noteId, text };
  });

/** A customer ticket of `requester` with its paired conversation, as a teammate opens one. */
export const ticketOf = (
  env: ContractEnv,
  workspaceId: string,
  requester: PrincipalId,
  conversationId: ConversationId,
) =>
  env.scoped(workspaceId, async (db) => {
    const [status] = await db
      .select({ id: ticketStatuses.id })
      .from(ticketStatuses)
      .where(
        and(
          eq(ticketStatuses.isDefault, true),
          isNull(ticketStatuses.deletedAt),
        ),
      )
      .orderBy(asc(ticketStatuses.position))
      .limit(1);
    const title = unique(env, "ticket_title");
    const [ticket] = await db
      .insert(tickets)
      .values({
        type: "customer",
        title,
        statusId: status!.id,
        requesterPrincipalId: requester,
      })
      .returning({ id: tickets.id, number: tickets.number });
    await db.insert(ticketConversations).values({
      ticketId: ticket!.id,
      conversationId,
      ticketType: "customer",
    });
    await db.insert(ticketSubscriptions).values({
      ticketId: ticket!.id,
      principalId: requester,
      reason: "requester",
    });
    return { ticketId: ticket!.id, number: ticket!.number, title };
  });

/**
 * A customer intake type with an optional visible field and a required field hidden from
 * customers, and a back-office type, in one workspace. Customers may file only the first, and see
 * only its visible field.
 */
export const ticketTypesIn = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const hiddenLabel = unique(env, "hidden_field");
    const backOfficeName = unique(env, "back_office_type");
    const [intake] = await db
      .insert(ticketTypes)
      .values({
        name: unique(env, "intake_type"),
        slug: env.id("intake"),
        category: "customer",
        fields: [
          {
            key: "browser",
            label: "Browser",
            type: "text",
            required: false,
            visibleToCustomer: true,
            order: 1,
          },
          {
            key: "internal_score",
            label: hiddenLabel,
            type: "number",
            required: true,
            visibleToCustomer: false,
            order: 2,
          },
        ],
      })
      .returning({ id: ticketTypes.id });
    const [backOffice] = await db
      .insert(ticketTypes)
      .values({
        name: backOfficeName,
        slug: env.id("back_office"),
        category: "back_office",
      })
      .returning({ id: ticketTypes.id });
    return {
      intakeTypeId: intake!.id,
      backOfficeTypeId: backOffice!.id,
      hiddenLabel,
      backOfficeName,
    };
  });

/** Workspace B rows for the foreign-ID checks and one other customer in A, created once per run. */
const shared = new Map<
  string,
  Promise<Awaited<ReturnType<typeof makeShared>>>
>();
async function makeShared(env: ContractEnv) {
  const other = await plainCustomer(env, env.a);
  const otherConversation = await conversationOf(env, env.a, other.principalId);
  const otherTicket = await ticketOf(
    env,
    env.a,
    other.principalId,
    otherConversation.conversationId,
  );
  const foreignCustomer = await plainCustomer(env, env.b);
  const foreign = await conversationOf(env, env.b, foreignCustomer.principalId);
  const foreignTicket = await ticketOf(
    env,
    env.b,
    foreignCustomer.principalId,
    foreign.conversationId,
  );
  return {
    otherName: other.name,
    other: otherConversation,
    otherTicket,
    foreign,
    foreignTicket,
    types: await ticketTypesIn(env, env.a),
    foreignTypes: await ticketTypesIn(env, env.b),
  };
}
export const sharedRows = (env: ContractEnv) => {
  if (!shared.has(env.a)) shared.set(env.a, makeShared(env));
  return shared.get(env.a)!;
};

/**
 * The caller of one audience in A with the surface on: a fresh widget visitor and its session
 * token, or customer A's portal profile.
 */
export async function callerOf(env: ContractEnv, audience: Customer) {
  if (audience === "portal") {
    await enablePortal(env, env.a);
    const profile = await env.portalCustomer(env.a, env.customerA);
    return {
      principalId: profile.principalId as PrincipalId,
      bearer: undefined,
    };
  }
  await enableMessenger(env, env.a);
  const visitor = await env.widgetVisitor(env.a);
  return {
    principalId: visitor.principalId as PrincipalId,
    bearer: visitor.token,
  };
}

/** Customer A's conversations and messages in A: another caller's request must not change them. */
export const snapshotOf = (env: ContractEnv, principalId: PrincipalId) =>
  env.scoped(env.a, async (db) => {
    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        visitorLastReadAt: conversations.visitorLastReadAt,
        csatRating: conversations.csatRating,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(eq(conversations.visitorPrincipalId, principalId))
      .orderBy(asc(conversations.id));
    const messages = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .innerJoin(
        conversations,
        eq(conversations.id, conversationMessages.conversationId),
      )
      .where(eq(conversations.visitorPrincipalId, principalId))
      .orderBy(asc(conversationMessages.id));
    const watches = await db
      .select({ ticketId: ticketSubscriptions.ticketId })
      .from(ticketSubscriptions)
      .where(eq(ticketSubscriptions.principalId, principalId))
      .orderBy(asc(ticketSubscriptions.ticketId));
    return { rows, messages, watches };
  });
