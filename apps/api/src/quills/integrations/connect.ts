// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { integrations } from "../../database/quills/schema/integrations";
import { z } from "../../openapi";
import type { Database, QuillsActor } from "../framework/define-route";
import { provider, type ProviderType } from "./catalog";

export const summaryColumns = {
  id: integrations.id,
  integrationType: integrations.integrationType,
  status: integrations.status,
  config: integrations.config,
  connectedAt: integrations.connectedAt,
};
type SummaryRow = {
  id: string;
  integrationType: string;
  status: string;
  config: Record<string, unknown>;
  connectedAt: Date | null;
};
const text = (value: unknown) => (typeof value === "string" ? value : null);

/** An integration without credentials. `config` holds only the display name and a non-secret account label. */
export const integrationSummary = z
  .object({
    id: z.string(),
    integrationType: z.string(),
    status: z.string(),
    workspaceName: z.string().nullable(),
    account: z.string().nullable(),
    connectedAt: z.string().nullable(),
  })
  .openapi("QuillsIntegrationSummary");
export const summary = (row: SummaryRow) => ({
  id: row.id,
  integrationType: row.integrationType,
  status: row.status,
  workspaceName: text(row.config.workspaceName),
  account: text(row.config.account),
  connectedAt: row.connectedAt?.toISOString() ?? null,
});

export const connected = z.object({ integration: integrationSummary });
export const connectErrors = {
  403: "Insufficient permission",
  409: "Set NOTIFICATION_SECRET_ENCRYPTION_KEY first",
};
export const connectedEvent = (
  _input: unknown,
  result: z.output<typeof connected>,
) => ({
  type: "integration.connected" as const,
  entityType: "integration" as const,
  entityId: result.integration.id,
  payload: { integrationType: result.integration.integrationType },
});

export type Connection = {
  /** Sealed with `sealCredentials`. */
  secrets: string;
  workspaceName: string;
  account: string | null;
  /** Non-secret provider IDs, for example a Slack team or a Discord server. */
  config?: Record<string, string>;
};

/** Creates the connection or replaces it. A new `connectedAt` starts a new installation; mappings stay. */
export async function connect(
  db: Database,
  actor: QuillsActor,
  type: ProviderType,
  connection: Connection,
) {
  const now = new Date();
  const values = {
    status: "active",
    secrets: connection.secrets,
    config: {
      ...connection.config,
      workspaceName: connection.workspaceName,
      account: connection.account,
    },
    connectedByPrincipalId: actor.principalId,
    connectedAt: now,
  };
  const [row] = await db
    .insert(integrations)
    .values({ integrationType: type, ...values })
    .onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.integrationType],
      set: {
        ...values,
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
        updatedAt: now,
      },
    })
    .returning(summaryColumns);
  return { integration: summary(row!) };
}

export const integrationParams = z.object({
  integrationId: flexibleToTypeIdSchema("integration"),
});

/** A connection of this workspace. 404 otherwise. */
export async function findIntegration(db: Database, id: TypeId<"integration">) {
  const [row] = await db
    .select(summaryColumns)
    .from(integrations)
    .where(eq(integrations.id, id));
  if (!row) throw new HTTPException(404, { message: "Integration not found" });
  return row;
}

/** 400 unless the provider delivers every listed event type. */
export function checkEvents(type: string, events: readonly string[]) {
  const supported = new Set<string>(provider(type)?.events ?? []);
  const unsupported = events.filter((event) => !supported.has(event));
  if (unsupported.length)
    throw new HTTPException(400, {
      message: `This integration does not deliver ${unsupported.join(", ")}`,
    });
}

const badUrl = (message: string) => new HTTPException(400, { message });

/**
 * A webhook URL on the provider's own HTTPS hosts, without credentials or a fragment. No DNS lookup here:
 * the hosts belong to the provider, and every delivery checks the resolved address again.
 */
export function ownHostUrl(type: ProviderType, value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !provider(type)?.hosts?.test(url.hostname)
  )
    throw badUrl(`Use an HTTPS ${provider(type)?.name} webhook URL.`);
  return url;
}

/** An ntfy topic URL: `https://host/topic`, where the topic has 1 to 64 letters, digits, `-` or `_`. */
export function ntfyTopic(url: string) {
  const topic = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic))
    throw badUrl(
      "Use an ntfy topic URL such as https://ntfy.sh/my-topic. A topic has letters, digits, - and _.",
    );
  return topic;
}

export const webhookBody = z.object({ webhookUrl: z.url().max(2048) });
