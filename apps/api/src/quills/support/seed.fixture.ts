import type { TypeId } from "@kaneo/ids";
import { and, asc, eq, isNull } from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import {
  channelAccounts,
  emailSendingDomains,
} from "../../database/quills/schema/channel-accounts";
import { companies } from "../../database/quills/schema/companies";
import {
  conversationMessages,
  conversations,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { macros } from "../../database/quills/schema/macros";
import { officeHoursSchedules } from "../../database/quills/schema/office-hours";
import { slaPolicies } from "../../database/quills/schema/sla";
import { teams } from "../../database/quills/schema/teams";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import {
  ticketConversations,
  ticketLinks,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import { workspaceUserTable } from "../../database/schema";
import { fixture, type ContractEnv } from "../framework/contract";

/** Support rows in one workspace. `caller` is the Kaneo user whose principal acts as a teammate. */
/**
 * Optional rows. Macros and link rows sit in tables with unindexed principal foreign keys, so the
 * contract suite seeds them only for the routes that need them: every extra row there slows each
 * later workspace delete that removes principals (see TICKETS.md, required migrations).
 */
type Part = "macro" | "links";

export async function side(
  env: ContractEnv,
  workspaceId: string,
  caller?: string,
  parts: readonly Part[] = [],
) {
  // An instance administrator is not a member, so the owner stands in as the assignable teammate.
  const [member] = caller
    ? await env.db
        .select({ userId: workspaceUserTable.userId })
        .from(workspaceUserTable)
        .where(
          and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            eq(workspaceUserTable.userId, caller),
          ),
        )
    : [];
  return env.scoped(workspaceId, async (db, actor) => {
    const [teammate] = member
      ? await db
          .select({ id: principal.id })
          .from(principal)
          .where(eq(principal.kaneoUserId, member.userId))
      : [];
    const teammateId = teammate?.id ?? actor.principalId;
    const statuses = await db
      .select({
        id: ticketStatuses.id,
        category: ticketStatuses.category,
        isDefault: ticketStatuses.isDefault,
      })
      .from(ticketStatuses)
      .where(isNull(ticketStatuses.deletedAt))
      .orderBy(asc(ticketStatuses.position));
    const open = statuses.find((s) => s.isDefault)!;
    const otherOpen = statuses.find(
      (s) => s.category === "open" && !s.isDefault,
    )!;
    const closed = statuses.find((s) => s.category === "closed")!;
    const [defaultTeam] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)));
    const teamId =
      defaultTeam?.id ??
      (
        await db
          .insert(teams)
          .values({ name: "Support", isDefault: true })
          .returning({ id: teams.id })
      )[0]!.id;
    // One contract customer and company per workspace, reused by every seed.
    const [company] =
      (await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.name, "Contract company"))
        .limit(1)) || [];
    const companyId =
      company?.id ??
      (
        await db
          .insert(companies)
          .values({ name: "Contract company" })
          .returning({ id: companies.id })
      )[0]!.id;
    const [existing] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.displayName, "Ada Customer"),
          eq(principal.companyId, companyId),
        ),
      )
      .limit(1);
    const customer =
      existing ??
      (
        await db
          .insert(principal)
          .values({
            type: "user",
            role: "user",
            displayName: "Ada Customer",
            createdAt: new Date(),
            companyId,
          })
          .returning({ id: principal.id })
      )[0];
    const [type] = await db
      .insert(ticketTypes)
      .values({
        name: "Bug",
        slug: env.id("type"),
        category: "customer",
        fields: [
          {
            key: "severity",
            label: "Severity",
            type: "select",
            required: true,
            visibleToCustomer: true,
            order: 0,
            options: ["low", "high"],
          },
        ],
      })
      .returning({ id: ticketTypes.id });
    const [archivedType] = await db
      .insert(ticketTypes)
      .values({
        name: "Old",
        slug: env.id("type"),
        category: "back_office",
        deletedAt: new Date(),
      })
      .returning({ id: ticketTypes.id });
    const [conversation] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: customer!.id,
        channel: "messenger",
        subject: "Login fails",
      })
      .returning({ id: conversations.id });
    const [otherConversation] = await db
      .insert(conversations)
      .values({ visitorPrincipalId: customer!.id, channel: "messenger" })
      .returning({ id: conversations.id });
    const newTicket = (values: Partial<typeof tickets.$inferInsert>) =>
      db
        .insert(tickets)
        .values({ title: "Contract ticket", statusId: open.id, ...values })
        .returning({ id: tickets.id })
        .then((rows) => rows[0]!.id);
    // Unassigned, so an assignment in a check always moves the ticket.
    const ticketId = await newTicket({ requesterPrincipalId: customer!.id });
    const backOfficeId = await newTicket({ type: "back_office" });
    const trackerId = await newTicket({ type: "tracker" });
    const trackedId = await newTicket({ requesterPrincipalId: customer!.id });
    if (parts.includes("links")) {
      await db
        .insert(ticketLinks)
        .values({ trackerTicketId: trackerId, linkedTicketId: trackedId });
      await db.insert(ticketConversations).values({
        ticketId: backOfficeId,
        conversationId: otherConversation!.id,
        ticketType: "back_office",
      });
    }
    const [message] = await db
      .insert(conversationMessages)
      .values({
        ticketId,
        principalId: customer!.id,
        senderType: "visitor",
        content: "Help",
      })
      .returning({ id: conversationMessages.id });
    const [tag] = await db
      .insert(conversationTags)
      .values({ name: env.id("tag") })
      .returning({ id: conversationTags.id });
    const [macro] = parts.includes("macro")
      ? await db
          .insert(macros)
          .values({
            name: "Thanks",
            body: "Hi {firstName}, thanks!",
            actions: [
              { type: "set_priority", priority: "high" },
              { type: "add_tag", tagId: tag!.id },
            ],
          })
          .returning({ id: macros.id })
      : [];
    const [schedule] = await db
      .insert(officeHoursSchedules)
      .values({ name: env.id("hours") })
      .returning({ id: officeHoursSchedules.id });
    const [policy] = await db
      .insert(slaPolicies)
      .values({ name: "Standard", firstResponseTargetSecs: 3600 })
      .returning({ id: slaPolicies.id });
    const [archivedPolicy] = await db
      .insert(slaPolicies)
      .values({
        name: "Old",
        firstResponseTargetSecs: 60,
        deletedAt: new Date(),
      })
      .returning({ id: slaPolicies.id });
    const domainName = `${env.id("mail").replaceAll("_", "-")}.example.test`;
    const [domain] = await db
      .insert(emailSendingDomains)
      .values({ owningTeamId: teamId, domain: domainName })
      .returning({ id: emailSendingDomains.id });
    const [unusedDomain] = await db
      .insert(emailSendingDomains)
      .values({ owningTeamId: teamId, domain: `unused-${domainName}` })
      .returning({ id: emailSendingDomains.id });
    const [address] = await db
      .insert(channelAccounts)
      .values({
        owningTeamId: teamId,
        role: "sending",
        address: `help@${domainName}`,
        module: "support",
        sendingDomainId: domain!.id,
      })
      .returning({ id: channelAccounts.id });
    const [inbound] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.owningTeamId, teamId),
          eq(channelAccounts.role, "inbound"),
          isNull(channelAccounts.deletedAt),
        ),
      );
    if (!inbound)
      await db.insert(channelAccounts).values({
        owningTeamId: teamId,
        role: "inbound",
        config: { forwardingTarget: "support@example.test" },
      });
    else
      await db
        .update(channelAccounts)
        .set({ config: { forwardingTarget: "support@example.test" } })
        .where(eq(channelAccounts.id, inbound.id));
    return {
      teammateId,
      customerId: customer!.id,
      companyId,
      teamId,
      openStatusId: open.id,
      otherStatusId: otherOpen.id,
      closedStatusId: closed.id,
      ticketTypeId: type!.id,
      archivedTypeId: archivedType!.id,
      conversationId: conversation!.id,
      ticketId,
      backOfficeId,
      trackerId,
      trackedId,
      messageId: message!.id,
      tagId: tag!.id,
      /** Only with the "macro" part. */
      macroId: macro?.id as TypeId<"macro">,
      scheduleId: schedule!.id,
      policyId: policy!.id,
      archivedPolicyId: archivedPolicy!.id,
      domainId: domain!.id,
      unusedDomainId: unusedDomain!.id,
      addressId: address!.id,
      domainName,
    };
  });
}

/** Seeds workspaces A and B, with the optional parts in both. */
export const seedFor =
  (...parts: Part[]) =>
  async (env: ContractEnv, caller: string) => ({
    a: await side(env, env.a, caller, parts),
    b: await side(env, env.b, undefined, parts),
  });
export const seed = seedFor();
export type Ids = Awaited<ReturnType<typeof seed>>;
type Side = Ids["a"];
type Db = Parameters<Parameters<ContractEnv["scoped"]>[1]>[0];

/** A request on one of A's tickets, with extra input and the workspace B values for its IDs. */
export const onTicket = (
  extra: (ids: Ids) => object = () => ({}),
  more: (ids: Ids) => Record<string, string> = () => ({}),
  key: "ticketId" | "backOfficeId" | "trackerId" = "ticketId",
  parts: Part[] = [],
) =>
  fixture({
    seed: seedFor(...parts),
    valid: (ids: Ids) => ({ params: { ticketId: ids.a[key] }, ...extra(ids) }),
    foreign: (ids: Ids) => ({ ticketId: ids.b[key], ...more(ids) }),
  });

/** Both workspaces, then extra rows in each, written as that workspace's owner. */
export const seedWith =
  <T extends object>(extra: (db: Db, ids: Side) => Promise<T>) =>
  async (env: ContractEnv, caller: string) => {
    const ids = await seed(env, caller);
    return {
      a: { ...ids.a, ...(await env.scoped(env.a, (db) => extra(db, ids.a))) },
      b: { ...ids.b, ...(await env.scoped(env.b, (db) => extra(db, ids.b))) },
    };
  };
