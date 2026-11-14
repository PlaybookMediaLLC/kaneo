import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { isTypeId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../database/quills/client";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { events } from "../../database/quills/schema/events";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { integrations } from "../../database/quills/schema/integrations";
import type { JobQueueRow } from "../../database/quills/schema/job-queue";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { appLinks } from "../apps/app-posts";
import { relatedPosts } from "../feedback/visibility";
import {
  openCredentials,
  ProviderCallError,
  providerJson,
} from "../framework/integration-config";
import { recordHealth } from "../jobs/handlers/integration";
import { refreshFailed } from "../jobs/handlers/integration-send";
import { claimDelivery, settleDelivery } from "../jobs/ledger";
import { finishQuillsJob } from "../jobs/queue";
import { portalPaths } from "../portal/paths";
import { callFailed, clip, uncertain, type Outcome } from "./delivery";
import { appCredentials, keepRefreshed } from "./oauth";
import { record, text } from "./oauth-providers";
import { freshSecrets, oauthProvider } from "./providers";
import { salesforceInstance } from "./providers/salesforce";

// CRM notes (RFC 0003, feature 19, D13). A critical vote by a customer of a company, or a teammate's
// link from a post to a CRM company, adds one note to that company in HubSpot or Salesforce. The
// note names the post, its board, the customer and the importance, and links to the post.
//
// The CRM record of a Quills company is its `externalId`: a HubSpot company ID or a Salesforce
// account ID. A link names the record itself: an app link (`linkQuillsAppPost`) of type `hubspot`
// or `salesforce`. A record ID that does not have the format of a connected CRM is no mapping: the
// job sends nothing and records nothing.
//
// Delivery follows the integration pattern: the job runs after commit, the hook_deliveries ledger
// key is per vote and company (or per post and linked record), the claim comes before the call, a
// busy provider (408, 429) is retried with the job backoff, and a call that may have created the
// note (no answer, 5xx) is uncertain and not sent again. Errors are fixed texts.

/** The record ID format of each CRM: a HubSpot company ID, a Salesforce account ID (prefix 001). */
const recordIds = {
  hubspot: /^[1-9]\d{0,19}$/,
  salesforce: /^001[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/,
};
type Crm = keyof typeof recordIds;
const CRMS = Object.keys(recordIds) as Crm[];
const isCrm = (value: unknown): value is Crm => CRMS.includes(value as Crm);

const UNCERTAIN = "The CRM note may exist. It is not sent again.";

export const crmNotePayloadSchema = z
  .object({ eventId: z.string().min(1).max(200), crm: z.literal("note") })
  .strict();

/** True for a note event in a workspace with an active CRM connection. The fan-out enqueues its job. */
export async function crmNoteDue(
  db: Database,
  event: { type: string; payload: unknown },
) {
  const payload = event.payload as Record<string, unknown>;
  if (
    !(
      (event.type === "post.vote_importance_set" &&
        payload.importance === "critical") ||
      (event.type === "app.post_linked" && isCrm(payload.externalType))
    )
  )
    return false;
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.status, "active"),
        inArray(integrations.integrationType, CRMS),
      ),
    )
    .limit(1);
  return Boolean(row);
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

type Note = {
  key: string;
  crm: Crm;
  recordId: string;
  title: string;
  lines: string[];
  connection: {
    id: (typeof integrations.$inferSelect)["id"];
    connectedAt: string | null;
  };
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  creds: Record<string, string>;
};

/** The note an event asks for, read from the live rows. Undefined: nothing to send. */
async function noteOf(
  db: Database,
  workspaceId: string,
  eventId: string,
): Promise<Note | undefined> {
  const [event] = await db
    .select({
      type: events.type,
      entityId: events.entityId,
      payload: events.payload,
    })
    .from(events)
    .where(eq(events.eventId, eventId));
  if (!event || !isTypeId(event.entityId, "post")) return undefined;
  const payload = event.payload as Record<string, unknown>;
  const [post] = await db
    .select({ id: posts.id, title: posts.title, board: boards.name })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(
      and(
        eq(posts.id, event.entityId),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
      ),
    );
  if (!post) return undefined;
  let target: { key: string; recordId: string; crms: Crm[]; lines: string[] };
  if (event.type === "post.vote_importance_set") {
    const voter = payload.principalId;
    if (typeof voter !== "string" || !isTypeId(voter, "principal"))
      return undefined;
    // The vote as it is now: still there and still critical, by a customer of a company.
    const [vote] = await db
      .select({
        id: postVotes.id,
        customer: principal.displayName,
        companyId: companies.id,
        recordId: companies.externalId,
      })
      .from(postVotes)
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .innerJoin(companies, eq(companies.id, principal.companyId))
      .where(
        and(
          eq(postVotes.principalId, voter),
          inArray(postVotes.postId, relatedPosts(db, post.id)),
          eq(postVotes.importance, "critical"),
        ),
      )
      .limit(1);
    if (!vote?.recordId) return undefined;
    target = {
      key: `crm-note:${vote.id}:${vote.companyId}`,
      recordId: vote.recordId,
      crms: CRMS,
      lines: [
        `Customer: ${clip(vote.customer ?? "A customer", 200)}`,
        "Importance: critical",
      ],
    };
  } else if (event.type === "app.post_linked") {
    const crm = payload.externalType;
    const recordId = text(payload.externalKey);
    if (!isCrm(crm) || !recordId) return undefined;
    // The link as it is now: a teammate may have removed it.
    const [link] = await db
      .select({ id: postExternalLinks.id })
      .from(postExternalLinks)
      .where(
        and(
          appLinks,
          eq(postExternalLinks.postId, post.id),
          eq(postExternalLinks.integrationType, crm),
          eq(postExternalLinks.externalId, recordId),
        ),
      )
      .limit(1);
    if (!link) return undefined;
    target = {
      key: `crm-note:link:${post.id}:${crm}:${recordId}`,
      recordId,
      crms: [crm],
      lines: [],
    };
  } else return undefined;
  const rows = await db
    .select({
      id: integrations.id,
      type: integrations.integrationType,
      config: integrations.config,
      connectedAt: integrations.connectedAt,
      secrets: integrations.secrets,
    })
    .from(integrations)
    .where(
      and(
        eq(integrations.status, "active"),
        inArray(integrations.integrationType, target.crms),
      ),
    );
  // The connected CRM whose record ID format the ID has. None: no mapping.
  const connection = rows.find((row) =>
    recordIds[row.type as Crm].test(target.recordId),
  );
  const secrets = connection && openCredentials(connection.secrets);
  if (!connection || !secrets) return undefined;
  const title = clip(post.title.replace(/\s+/g, " ").trim(), 200);
  return {
    key: target.key,
    crm: connection.type as Crm,
    recordId: target.recordId,
    title,
    lines: [
      `Feature request: ${title}`,
      `Board: ${clip(post.board, 200)}`,
      ...target.lines,
      `Post: ${portalPaths.post(workspaceId, post.id)}`,
    ],
    connection: {
      id: connection.id,
      connectedAt: connection.connectedAt?.toISOString() ?? null,
    },
    config: connection.config,
    secrets,
    creds: (await appCredentials(db, connection.type)) ?? {},
  };
}

/** One note create. A refused call throws, as providerJson does. */
async function createNote(
  note: Note,
  secrets: Record<string, string>,
): Promise<Outcome> {
  const headers = {
    authorization: `Bearer ${secrets.accessToken ?? ""}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  let answer: Record<string, unknown>;
  if (note.crm === "hubspot") {
    answer = record(
      await providerJson(
        "https://api.hubapi.com/crm/v3/objects/notes",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: {
              hs_timestamp: new Date().toISOString(),
              hs_note_body: note.lines.map(escapeHtml).join("<br>"),
            },
            // 190: HubSpot's note-to-company association.
            associations: [
              {
                to: { id: note.recordId },
                types: [
                  {
                    associationCategory: "HUBSPOT_DEFINED",
                    associationTypeId: 190,
                  },
                ],
              },
            ],
          }),
        },
        oauthProvider("hubspot")!.hosts,
      ),
    );
  } else {
    const instance = salesforceInstance(note.config.instanceUrl);
    if (!instance) throw new ProviderCallError(401);
    answer = record(
      await providerJson(
        `${instance}/services/data/v62.0/sobjects/Note`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ParentId: note.recordId,
            Title: clip(`Feature request: ${note.title}`, 80),
            Body: note.lines.join("\n"),
          }),
        },
        oauthProvider("salesforce")!.hosts,
      ),
    );
  }
  // A 2xx without an ID does not prove the note.
  return text(answer.id) ? { state: "succeeded" } : uncertain;
}

/** The call with a fresh token. Never retries inside; the job and the ledger decide. */
async function send(note: Note): Promise<Outcome> {
  let fresh: Awaited<ReturnType<typeof freshSecrets>>;
  try {
    fresh = await freshSecrets(note.crm, note.secrets, note.creds);
  } catch (error) {
    return refreshFailed(error);
  }
  const refreshed = fresh.refreshed ?? undefined;
  try {
    return { ...(await createNote(note, fresh.secrets)), refreshed };
  } catch (error) {
    // A 403 is a connection without the write scope.
    return error instanceof ProviderCallError && error.status === 403
      ? {
          state: "auth_required",
          errorCode: "write_access_required",
          refreshed,
        }
      : { ...callFailed(error), refreshed };
  }
}

/** `quills.webhook`: one CRM note for one note event (crmNoteDue). */
export async function runCrmNoteJob(workspaceId: string, job: JobQueueRow) {
  const { eventId } = crmNotePayloadSchema.parse(job.payload);
  const system = <T>(work: (db: Database) => Promise<T>) =>
    withQuillsSystemWorkspace(workspaceId, work);
  const finish = (error?: string, permanent?: boolean) =>
    system((db) =>
      finishQuillsJob(db, job.id, job.leaseToken!, error, permanent),
    );
  const prepared = await system(async (db) => {
    const note = await noteOf(db, workspaceId, eventId);
    return (
      note && { note, claim: await claimDelivery(db, note.key, "crm_note") }
    );
  });
  if (!prepared || prepared.claim === "completed") return finish();
  if (prepared.claim === "uncertain") return finish(UNCERTAIN, true);
  const { note } = prepared;
  const sent = await send(note);
  // The job's last attempt turns a wait into a failure.
  const outcome: Outcome =
    sent.state === "retry_wait" && job.attempts >= job.maxAttempts
      ? { ...sent, state: "failed" }
      : sent;
  // Its own transaction, so a lease lost later cannot erase what happened.
  await system(async (db) => {
    await settleDelivery(
      db,
      note.key,
      outcome.state === "succeeded"
        ? "completed"
        : outcome.state === "uncertain"
          ? "uncertain"
          : "failed",
    );
    await keepRefreshed(db, note.connection, outcome.refreshed ?? null);
    await recordHealth(db, note.connection.id, outcome);
  });
  if (outcome.state === "succeeded") return finish();
  if (outcome.state === "uncertain") return finish(UNCERTAIN, true);
  return finish(
    `CRM note ${outcome.errorCode ?? "failed"}`,
    outcome.state !== "retry_wait",
  );
}
