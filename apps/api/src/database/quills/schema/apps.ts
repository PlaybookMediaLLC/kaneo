import { sql } from "drizzle-orm";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { check, foreignKey, primaryKey } from "drizzle-orm/pg-core";
/**
 * Third-party app platform (EVENTING-V2 §3.6 / WO-12).
 *
 * An app is the unit of third-party extension: an OAuth 2.1 client + granted
 * capability scopes + an optional signed webhook endpoint + subscribed event
 * types. The app-webhook resolver (WO-13) reads this table alongside the legacy
 * webhooks table; a subscription to an event is honoured only if the app's
 * granted_scopes include the catalogue def's requiredScope — subscription authz
 * is a scope check against the vocabulary already shared by REST/MCP/OAuth.
 */
import { text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { oauthClient } from "./auth";

export const apps = quillsSchema
  .table(
    "apps",
    {
      workspaceId: workspaceColumn(),
      /** TypeID 'app_...'. */
      id: text("id").notNull(),
      /** FK to the better-auth oauth client of an imported Quackback app. Kaneo never authorizes with it. */
      oauthClientId: text("oauth_client_id"),
      /**
       * The Kaneo API key (public.apikey.id) that the app authenticates with (RFC 0001, D12).
       * No foreign key: the key lives in the public schema, and a deleted key leaves an inert ID.
       */
      apiKeyId: text("api_key_id"),
      name: text("name").notNull(),
      /** Capability scopes the app was granted (shared api-key-scopes vocabulary). */
      grantedScopes: text("granted_scopes").array().notNull().default([]),
      /** HMAC-signed webhook delivery endpoint (nullable = no webhook). */
      webhookEndpoint: text("webhook_endpoint"),
      /** Encrypted signing secret (reuse integrations/encryption); never plaintext. */
      webhookSecretEnc: text("webhook_secret_enc"),
      /** Event types this app subscribes to (gated by grantedScopes at resolve time). */
      subscribedEventTypes: text("subscribed_event_types")
        .array()
        .notNull()
        .default([]),
      /** 'active' | 'disabled'. */
      status: text("status").notNull().default("active"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("apps_oauth_client_id_idx").on(
        table.workspaceId,
        table.oauthClientId,
      ),
      // One app per key in each workspace. The app gate and the teammate confinement read it.
      uniqueIndex("apps_api_key_id_idx")
        .on(table.workspaceId, table.apiKeyId)
        .where(sql`${table.apiKeyId} IS NOT NULL`),
      check(
        "apps_credential_check",
        sql`num_nonnulls(${table.oauthClientId}, ${table.apiKeyId}) <= 1`,
      ),
      index("apps_status_idx").on(table.status),
      index("apps_subscribed_events_idx").using(
        "gin",
        table.subscribedEventTypes,
      ),
      primaryKey({ columns: [table.workspaceId, table.id] }),
      foreignKey({
        columns: [table.workspaceId, table.oauthClientId],
        foreignColumns: [oauthClient.workspaceId, oauthClient.clientId],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export type AppRow = typeof apps.$inferSelect;
export type NewAppRow = typeof apps.$inferInsert;
