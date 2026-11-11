import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { ticketExternalLinks as links } from "../../database/quills/schema/external-links";
import { integrationSyncOperations as operations } from "../../database/quills/schema/integration-sync";
import {
  integrationEventMappings as mappings,
  integrations,
} from "../../database/quills/schema/integrations";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { httpsUrl, installationOf, provider } from "../integrations/catalog";
import { DEFAULT_TARGET } from "../integrations/channels";
import { githubRepo, validTarget } from "../integrations/oauth-providers";
import { findTicket, systemMessage, ticketParams } from "./ticket-view";

// A ticket's links to issues in the connected trackers that P7b built (GitHub, GitLab): list, link an
// existing issue, create a new one, unlink. The issue must be in one of the connection's channels
// (a repository or project), as for item search. Creating calls the provider after commit: the
// request queues one sync operation per ticket and channel, and the integration worker sends it.

const TRACKERS = ["github", "gitlab"] as const;
const errors = {
  400: "The issue reference does not name an issue in this connection's channels",
  404: "Ticket, connection or link not found",
};
const linkView = z.object({
  id: z.string(),
  integrationType: z.string(),
  externalId: z.string(),
  externalDisplayId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  createdAt: z.string(),
});
const linkColumns = {
  id: links.id,
  integrationType: links.integrationType,
  externalId: links.externalId,
  externalDisplayId: links.externalDisplayId,
  externalUrl: links.externalUrl,
  createdAt: links.createdAt,
};
type LinkRow = {
  id: string;
  integrationType: string;
  externalId: string;
  externalDisplayId: string | null;
  externalUrl: string | null;
  createdAt: Date;
};
const toView = (row: LinkRow) => ({
  ...row,
  externalUrl: httpsUrl(row.externalUrl),
  createdAt: row.createdAt.toISOString(),
});
const name = (type: string) => provider(type)?.name ?? type;
const bad = (message: string) => new HTTPException(400, { message });

/** The channels (repositories or projects) of a connection. */
async function channelsOf(db: Database, integrationId: TypeId<"integration">) {
  const rows = await db
    .selectDistinct({ target: mappings.targetKey })
    .from(mappings)
    .where(
      and(
        eq(mappings.integrationId, integrationId),
        ne(mappings.targetKey, DEFAULT_TARGET),
      ),
    )
    .orderBy(asc(mappings.targetKey))
    .limit(200);
  return rows.map((row) => row.target);
}

/** An active issue-tracker connection of this workspace and its channels. 404 otherwise. */
async function findTracker(db: Database, id: TypeId<"integration">) {
  const [row] = await db
    .select({
      id: integrations.id,
      type: integrations.integrationType,
      connectedAt: integrations.connectedAt,
    })
    .from(integrations)
    .where(
      and(
        eq(integrations.id, id),
        eq(integrations.status, "active"),
        inArray(integrations.integrationType, TRACKERS),
      ),
    );
  if (!row) throw new HTTPException(404, { message: "Connection not found" });
  return { ...row, channels: await channelsOf(db, row.id) };
}

/**
 * An issue reference in one of the channels: GitHub `owner/repo#12` or its issue URL, GitLab
 * `<project ID>#12`. Undefined otherwise.
 */
function parseIssue(type: string, value: string, channels: string[]) {
  if (type === "github") {
    const match =
      /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:#|\/issues\/)(\d{1,10})\/?$/.exec(
        value.trim(),
      );
    const target = match && `${match[1]}:${match[2]}`;
    if (!target || !validTarget(type, target) || !channels.includes(target))
      return undefined;
    const externalId = `${githubRepo(target)}#${match[3]}`;
    return {
      externalId,
      externalUrl: `https://github.com/${githubRepo(target)}/issues/${match[3]}`,
      target,
    };
  }
  const match = /^(\d{1,20})#(\d{1,10})$/.exec(value.trim());
  if (!match || !channels.includes(match[1]!)) return undefined;
  return {
    externalId: `${match[1]}#${match[2]}`,
    externalUrl: null,
    target: match[1]!,
  };
}

const list = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/external-links",
  operationId: "listQuillsTicketExternalLinks",
  summary: "List a ticket's linked tracker issues",
  description:
    "The ticket's active links, oldest first (at most 100), and the connected issue trackers with the channels an issue can be linked in or created in.",
  action: "read",
  params: ticketParams,
  response: z.object({
    links: z.array(linkView),
    trackers: z.array(
      z.object({
        integrationId: z.string(),
        integrationType: z.string(),
        name: z.string(),
        channels: z.array(z.string()),
      }),
    ),
  }),
  responseDescription: "Links and linkable trackers",
  errors,
  handler: async ({ db, params }) => {
    await findTicket(db, params.ticketId);
    const rows = await db
      .select(linkColumns)
      .from(links)
      .where(
        and(eq(links.ticketId, params.ticketId), eq(links.status, "active")),
      )
      .orderBy(asc(links.createdAt), asc(links.id))
      .limit(100);
    const trackers = await db
      .select({ id: integrations.id, type: integrations.integrationType })
      .from(integrations)
      .where(
        and(
          eq(integrations.status, "active"),
          inArray(integrations.integrationType, TRACKERS),
        ),
      );
    return {
      links: rows.map(toView),
      trackers: await Promise.all(
        trackers.map(async (row) => ({
          integrationId: row.id,
          integrationType: row.type,
          name: name(row.type),
          channels: await channelsOf(db, row.id),
        })),
      ),
    };
  },
});

const link = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/external-links",
  operationId: "linkQuillsTicketIssue",
  summary: "Link a ticket to an existing tracker issue",
  description:
    "GitHub: `owner/repo#12` or the issue URL; GitLab: `<project ID>#12`. The repository or project must be one of the connection's channels. Linking the same issue again changes nothing. No provider call: the reference is not checked remotely.",
  action: "update",
  params: ticketParams,
  body: z.object({
    integrationId: flexibleToTypeIdSchema("integration"),
    issue: z.string().trim().min(1).max(500),
  }),
  response: linkView.extend({ changed: z.boolean() }),
  responseDescription: "The link",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.external_linked",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { linkId: result.id, integrationType: result.integrationType },
    },
  handler: async ({ db, actor, params, body }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    const tracker = await findTracker(db, body.integrationId);
    const issue = parseIssue(tracker.type, body.issue, tracker.channels);
    if (!issue)
      throw bad(
        `Enter a ${name(tracker.type)} issue in one of the connection's channels`,
      );
    const syncScope = `${installationOf(tracker)}:${issue.target}`;
    const [created] = await db
      .insert(links)
      .values({
        ticketId: ticket.id,
        integrationId: tracker.id,
        integrationType: tracker.type,
        externalId: issue.externalId,
        externalDisplayId: issue.externalId,
        externalUrl: issue.externalUrl,
        syncScope,
        origin: "reference",
        createdByPrincipalId: actor.principalId,
      })
      .onConflictDoNothing()
      .returning(linkColumns);
    if (created)
      // Team-only: never on the customer's thread.
      await systemMessage(
        db,
        ticket.id,
        `Linked ${name(tracker.type)} issue ${issue.externalId}`,
        {
          kind: "external_linked",
          externalReference: issue.externalId,
          ...(issue.externalUrl && { externalUrl: issue.externalUrl }),
        },
        true,
      );
    const [row] = created
      ? [created]
      : await db
          .select(linkColumns)
          .from(links)
          .where(
            and(
              eq(links.ticketId, ticket.id),
              eq(links.integrationType, tracker.type),
              eq(links.externalId, issue.externalId),
              eq(links.syncScope, syncScope),
            ),
          );
    return { ...toView(row!), changed: Boolean(created) };
  },
});

const create = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/external-links/issue",
  operationId: "createQuillsTicketIssue",
  summary: "Create a tracker issue from a ticket",
  description:
    "Queues the issue for the integration worker, which creates it after this request commits and then links it. One create per ticket and channel: asking again returns the same operation. Follow it in the connection's sync history.",
  action: "update",
  params: ticketParams,
  body: z.object({
    integrationId: flexibleToTypeIdSchema("integration"),
    target: z.string().min(1).max(100),
  }),
  response: z.object({
    operationId: z.string(),
    state: z.string(),
    changed: z.boolean(),
  }),
  responseDescription: "The queued operation",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.issue_requested",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { operationId: result.operationId },
    },
  handler: async ({ db, actor, params, body }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    const tracker = await findTracker(db, body.integrationId);
    if (
      !validTarget(tracker.type, body.target) ||
      !tracker.channels.includes(body.target)
    )
      throw bad("Choose one of the connection's channels");
    const installation = installationOf(tracker);
    // One create per installation, ticket and channel.
    const key = `sync:ticket-create:${installation}:${ticket.id}:${body.target}`;
    const [queued] = await db
      .insert(operations)
      .values({
        operationKey: key,
        integrationId: tracker.id,
        installation,
        provider: tracker.type,
        direction: "outbound",
        kind: "create",
        sourceType: "ticket",
        sourceId: ticket.id,
        destination: { target: body.target, event: "ticket.issue_requested" },
        destinationKey: body.target,
        requestedBy: actor.principalId,
      })
      .onConflictDoNothing()
      .returning({ id: operations.id, state: operations.state });
    const [op] = queued
      ? [queued]
      : await db
          .select({ id: operations.id, state: operations.state })
          .from(operations)
          .where(eq(operations.operationKey, key));
    return { operationId: op!.id, state: op!.state, changed: Boolean(queued) };
  },
});

const unlink = defineQuillsRoute({
  method: "delete",
  path: "/tickets/{ticketId}/external-links/{linkId}",
  operationId: "unlinkQuillsTicketIssue",
  summary: "Remove a ticket's tracker issue link",
  description: "The issue itself stays in the tracker.",
  action: "update",
  params: ticketParams.extend({
    linkId: flexibleToTypeIdSchema("ticket_external_link"),
  }),
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a link was removed",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.external_unlinked",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { linkId: params.linkId },
    },
  handler: async ({ db, params }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    const [removed] = await db
      .delete(links)
      .where(and(eq(links.id, params.linkId), eq(links.ticketId, ticket.id)))
      .returning({
        integrationType: links.integrationType,
        externalId: links.externalId,
        externalDisplayId: links.externalDisplayId,
      });
    if (!removed) throw new HTTPException(404, { message: "Link not found" });
    const reference = removed.externalDisplayId ?? removed.externalId;
    await systemMessage(
      db,
      ticket.id,
      `Unlinked ${name(removed.integrationType)} issue ${reference}`,
      { kind: "external_unlinked", externalReference: reference },
      true,
    );
    return { changed: true };
  },
});

/** Teammate routes for a ticket's tracker issue links. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...list)
  .openapi(...link)
  .openapi(...create)
  .openapi(...unlink);
