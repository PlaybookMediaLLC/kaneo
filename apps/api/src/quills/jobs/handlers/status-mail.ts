import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  sendStatusIncidentPublishedEmail,
  sendStatusMaintenanceScheduledEmail,
  type IncidentImpact,
} from "@kaneo/email/quills";
import type { PrincipalId, StatusIncidentId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import {
  statusIncidents,
  statusSubscriptions,
} from "../../../database/quills/schema/status";
import { viewerSegments } from "../../content/public/help-center/visibility";
import {
  openStatusPage,
  publicIncidents,
} from "../../content/public/status/visibility";
import { realEmail } from "../../directory/customer";
import { portalAccount } from "../../framework/platform-reads";
import {
  mintUnsubscribeToken,
  unsubscribePageUrl,
  unsubscribeUrl,
} from "../../portal/unsubscribe-token";
import { portalPaths } from "../../portal/paths";
import type { DeliveryEvent, Subscribers } from "../fanout";

// Status-page subscriber mail: an incident published or updated, and a maintenance window that
// starts. Recipients are the live subscriptions. Each mail shows only what the subscriber may see
// (component segment gates); the send-time check (`statusAddress`) applies the module flag, the
// page switch, the private-portal gate and the page audience. One mail per event and subscriber.

type Mail = "incident" | "maintenance";
const payloadOf = (event: DeliveryEvent) =>
  event.payload as Record<string, string | undefined>;
/** Statuses during which a maintenance window has started. */
const RUNNING = new Set(["in_progress", "verifying"]);
const label = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
const incidentUrl = (workspaceId: string, incidentId: string) =>
  portalPaths.statusIncident(workspaceId, incidentId);

/**
 * Which mail the event asks for: an incident's publish or update, or a window's start (the start
 * route or sweep, a timeline update from scheduled to running, or a window published running).
 */
function mailOf(event: DeliveryEvent): Mail | undefined {
  const { kind, status, previousStatus } = payloadOf(event);
  if (event.type === "status.maintenance_started") return "maintenance";
  if (kind === "incident")
    return event.type === "status.incident_published" ||
      event.type === "status.incident_update_posted" ||
      event.type === "status.incident_resolved"
      ? "incident"
      : undefined;
  if (kind !== "maintenance") return undefined;
  if (event.type === "status.incident_published")
    return RUNNING.has(status ?? "") ? "maintenance" : undefined;
  return event.type === "status.incident_update_posted" &&
    previousStatus === "scheduled" &&
    RUNNING.has(status ?? "")
    ? "maintenance"
    : undefined;
}

/** The live, published incident the event is about and its mail, when it notifies subscribers. */
async function notifyingIncident(db: Database, event: DeliveryEvent) {
  if (event.entityType !== "status_incident") return;
  const [row] = await db
    .select({
      id: statusIncidents.id,
      kind: statusIncidents.kind,
      status: statusIncidents.status,
    })
    .from(statusIncidents)
    .where(
      and(
        eq(statusIncidents.id, event.entityId as StatusIncidentId),
        isNull(statusIncidents.deletedAt),
        eq(statusIncidents.notifySubscribers, true),
        eq(statusIncidents.backfilled, false),
      ),
    );
  const mail = row && mailOf(event);
  return mail && { ...row, mail };
}

/** Live subscribers of a notifying incident. Fan-out keeps customers and drops the actor. */
const subscribers: Subscribers["recipients"] = async (db, event) => {
  if (!(await notifyingIncident(db, event))) return { principalIds: [] };
  // ponytail: one mail job per subscriber, at most 10,000; batch sends if pages grow past that.
  const rows = await db
    .select({ principalId: statusSubscriptions.principalId })
    .from(statusSubscriptions)
    .where(isNull(statusSubscriptions.unsubscribedAt))
    .limit(10_000);
  return { principalIds: rows.map((row) => row.principalId) };
};

/**
 * The subscriber's address at send time: a live, unblocked customer whose Kaneo account address
 * is verified (or a widget profile's address), while the status page is open to them (module
 * flag, page switch, private-portal gate, page audience). Undefined means no mail.
 */
async function statusAddress(workspaceId: string, principalId: PrincipalId) {
  const person = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [row] = await db
      .select({
        customerId: customer.id,
        kaneoUserId: customer.kaneoUserId,
        email: customer.email,
        blockedAt: principal.blockedAt,
        teammate: principal.kaneoUserId,
        test: principal.testOwnerPrincipalId,
      })
      .from(principal)
      .innerJoin(customer, eq(customer.id, principal.userId))
      .where(eq(principal.id, principalId));
    return row;
  });
  if (!person || person.blockedAt || person.teammate || person.test) return;
  const account = person.kaneoUserId
    ? await portalAccount(workspaceId, person.kaneoUserId)
    : undefined;
  // An unverified account address may belong to someone else.
  if (person.kaneoUserId && !account?.emailVerified) return;
  const open = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    try {
      await openStatusPage(db, {
        principalId,
        customerId: person.customerId,
        account: account ?? null,
      });
      return true;
    } catch (error) {
      if (error instanceof HTTPException) return false;
      throw error;
    }
  });
  if (!open) return;
  return realEmail(account ? account.email : person.email) ?? undefined;
}

/**
 * The subscriber's mail, with only the components they may see. A components subscription hears
 * only about incidents that affect one of its components.
 */
const statusMail: NonNullable<Subscribers["mail"]> = async (
  db,
  event,
  principalId,
) => {
  const incident = await notifyingIncident(db, event);
  const mail = incident?.mail;
  const [subscription] = principalId
    ? await db
        .select({
          scope: statusSubscriptions.scope,
          componentIds: statusSubscriptions.componentIds,
        })
        .from(statusSubscriptions)
        .where(
          and(
            eq(statusSubscriptions.principalId, principalId),
            isNull(statusSubscriptions.unsubscribedAt),
          ),
        )
    : [];
  const [workspace] = await db
    .select({ id: settings.workspaceId, name: settings.name })
    .from(settings)
    .limit(1);
  if (!mail || !incident || !subscription || !workspace || !principalId) return;
  const [shown] = await publicIncidents(
    db,
    [incident.id],
    await viewerSegments(db, principalId),
  );
  if (!shown) return;
  if (
    subscription.scope === "components" &&
    !shown.affectedComponents.some((c) =>
      subscription.componentIds.includes(c.id),
    )
  )
    return;
  const token = await mintUnsubscribeToken(
    db,
    principalId,
    "unsubscribe_status",
  );
  const common = {
    workspaceName: workspace.name,
    body: shown.updates.at(-1)?.body ?? "",
    incidentUrl: incidentUrl(workspace.id, shown.id),
    unsubscribeUrl: unsubscribePageUrl(workspace.id, token),
    oneClickUnsubscribeUrl: unsubscribeUrl(workspace.id, token),
  };
  const when = (at: Date | string | null) =>
    at ? new Date(at).toUTCString() : "";
  return {
    type: "status_incident",
    emailType:
      mail === "incident"
        ? "StatusIncidentPublishedEmail"
        : "StatusMaintenanceScheduledEmail",
    customerAddress: statusAddress,
    send: (to) =>
      mail === "incident"
        ? sendStatusIncidentPublishedEmail({
            ...common,
            to,
            incidentTitle: shown.title,
            impact: (shown.impact === "maintenance"
              ? "none"
              : shown.impact) as IncidentImpact,
            statusLabel: label(shown.status),
            affectedComponents: shown.affectedComponents.map((c) => ({
              name: c.name,
              status: label(c.componentStatus),
            })),
          })
        : sendStatusMaintenanceScheduledEmail({
            ...common,
            to,
            maintenanceTitle: shown.title,
            startLabel: when(shown.scheduledStartAt ?? shown.startedAt),
            endLabel: when(shown.scheduledEndAt),
            affectedComponents: shown.affectedComponents.map((c) => c.name),
          }),
  };
};

const entry: Subscribers = {
  recipients: subscribers,
  customers: true,
  mail: statusMail,
};

/** Status entries for jobs/fanout.ts#subscribers. */
export const statusSubscribers: Partial<Record<string, Subscribers>> = {
  "status.incident_published": entry,
  "status.incident_update_posted": entry,
  "status.incident_resolved": entry,
  "status.maintenance_started": entry,
};
