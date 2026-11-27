import {
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  typeIdColumn,
  typeIdColumnNullable,
  typeIdWithDefault,
} from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { principal } from "./auth";
import { changelogEntries } from "./changelog";
import { posts } from "./posts";
import { tickets } from "./tickets";

export const RELEASE_SOURCES = [
  "github_release",
  "github_tag",
  "github_deployment",
  "manual",
] as const;
export type ReleaseSource = (typeof RELEASE_SOURCES)[number];

export const VERIFIED_RELEASE_STATUSES = [
  "draft",
  "approved",
  "shipped",
] as const;
export type VerifiedReleaseStatus = (typeof VERIFIED_RELEASE_STATUSES)[number];

/**
 * Verified product releases (#298). A merged PR NEVER notifies customers; only a verified release
 * (GitHub release published, production deployment_status=success, release tag push, or manual
 * team trigger) enters this table, generates an approval-pending changelog draft, and on human
 * approval transitions linked requests/tickets and sends deduplicated requester notifications.
 */
export const verifiedReleases = quillsSchema
  .table(
    "verified_releases",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("verified_release")("id").notNull(),
      version: text("version").notNull(),
      title: text("title").notNull(),
      source: text("source").$type<ReleaseSource>().notNull(),
      externalUrl: text("external_url"),
      commitSha: text("commit_sha"),
      taskIds: jsonb("task_ids").$type<string[]>().notNull().default([]),
      postIds: jsonb("post_ids").$type<string[]>().notNull().default([]),
      ticketIds: jsonb("ticket_ids").$type<string[]>().notNull().default([]),
      changelogEntryId: typeIdColumnNullable("changelog")("changelog_entry_id"),
      status: text("status")
        .$type<VerifiedReleaseStatus>()
        .notNull()
        .default("draft"),
      verifiedAt: timestamp("verified_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      approvedAt: timestamp("approved_at", { withTimezone: true }),
      approvedByPrincipalId: typeIdColumnNullable("principal")(
        "approved_by_principal_id",
      ),
      shippedAt: timestamp("shipped_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("verified_releases_ws_version_idx").on(
        table.workspaceId,
        table.version,
      ),
      index("verified_releases_ws_status_idx").on(
        table.workspaceId,
        table.status,
      ),
      foreignKey({
        name: "verified_releases_changelog_fk",
        columns: [table.workspaceId, table.changelogEntryId],
        foreignColumns: [changelogEntries.workspaceId, changelogEntries.id],
      }).onDelete("set null"),
      foreignKey({
        name: "verified_releases_approver_fk",
        columns: [table.workspaceId, table.approvedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Explicit ticket <-> feedback post link table (#298). Written whenever a ticket records or votes
 * on a feedback post, so verified releases can close linked support tickets and deduplicate
 * requester notifications across both feedback posts and support tickets.
 */
export const ticketPosts = quillsSchema
  .table(
    "ticket_posts",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("ticket_post")("id").notNull(),
      ticketId: typeIdColumn("ticket")("ticket_id").notNull(),
      postId: typeIdColumn("post")("post_id").notNull(),
      createdByPrincipalId: typeIdColumnNullable("principal")(
        "created_by_principal_id",
      ),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("ticket_posts_ws_ticket_post_idx").on(
        table.workspaceId,
        table.ticketId,
        table.postId,
      ),
      index("ticket_posts_ws_post_idx").on(table.workspaceId, table.postId),
      foreignKey({
        name: "ticket_posts_ticket_fk",
        columns: [table.workspaceId, table.ticketId],
        foreignColumns: [tickets.workspaceId, tickets.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "ticket_posts_post_fk",
        columns: [table.workspaceId, table.postId],
        foreignColumns: [posts.workspaceId, posts.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "ticket_posts_creator_fk",
        columns: [table.workspaceId, table.createdByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Deduplicated customer notification ledger per verified release (#298).
 * The unique index on (workspace_id, release_id, principal_id) guarantees at the database level
 * that a customer receives at most ONE personal notification per release even when they upvoted
 * multiple posts and opened multiple support tickets shipped in the same release.
 */
export const releaseNotifications = quillsSchema
  .table(
    "release_notifications",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("release_notification")("id").notNull(),
      releaseId: typeIdColumn("verified_release")("release_id").notNull(),
      principalId: typeIdColumn("principal")("principal_id").notNull(),
      channel: text("channel")
        .$type<"in_app" | "email" | "conversation">()
        .notNull(),
      subject: text("subject").notNull(),
      body: text("body").notNull(),
      quotedText: text("quoted_text"),
      postIds: jsonb("post_ids").$type<string[]>().notNull().default([]),
      ticketIds: jsonb("ticket_ids").$type<string[]>().notNull().default([]),
      sentAt: timestamp("sent_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("release_notifications_ws_release_principal_idx").on(
        table.workspaceId,
        table.releaseId,
        table.principalId,
      ),
      index("release_notifications_ws_principal_idx").on(
        table.workspaceId,
        table.principalId,
      ),
      foreignKey({
        name: "release_notifications_release_fk",
        columns: [table.workspaceId, table.releaseId],
        foreignColumns: [verifiedReleases.workspaceId, verifiedReleases.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "release_notifications_principal_fk",
        columns: [table.workspaceId, table.principalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
