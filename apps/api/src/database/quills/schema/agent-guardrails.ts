import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  typeIdColumn,
  typeIdColumnNullable,
  typeIdWithDefault,
} from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import type { ConversationMessageCitation } from "../types";
import { principal } from "./auth";
import { conversationMessages, conversations } from "./conversation";

export const DECLINE_TOPIC_POLICIES = ["quote_only", "always_handoff"] as const;
export type DeclineTopicPolicy = (typeof DECLINE_TOPIC_POLICIES)[number];

export const AGENT_CHANNEL_MODES = ["off", "draft", "auto"] as const;
export type AgentChannelMode = (typeof AGENT_CHANNEL_MODES)[number];

export const ASSISTANT_DRAFT_STATUSES = [
  "pending",
  "sent",
  "dismissed",
] as const;
export type AssistantDraftStatus = (typeof ASSISTANT_DRAFT_STATUSES)[number];

/**
 * Per-workspace declined/restricted topics for the customer agent (#299).
 * Seeded with pricing, refunds, policies, and contract_terms (all `quote_only`) so the agent
 * never improvises or paraphrases sensitive commitments.
 */
export const agentDeclineTopics = quillsSchema
  .table(
    "agent_decline_topics",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("agent_decline_topic")("id").notNull(),
      slug: text("slug").notNull(),
      label: text("label").notNull(),
      policy: text("policy", { enum: DECLINE_TOPIC_POLICIES })
        .notNull()
        .default("quote_only"),
      examples: jsonb("examples").$type<string[]>().notNull().default([]),
      enabled: boolean("enabled").notNull().default(true),
      isDefault: boolean("is_default").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      unique("agent_decline_topics_workspace_slug_unique").on(
        table.workspaceId,
        table.slug,
      ),
      check(
        "agent_decline_topics_policy_check",
        sql`${table.policy} IN ('quote_only','always_handoff')`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export type EvalCaseDetail = {
  id: string;
  category: "grounding" | "escalation" | "decline" | "tool_allowlist";
  passed: boolean;
  reason?: string;
};

/**
 * Persisted AI evaluation runs gating per-channel `auto` mode (#299).
 * Switching a channel to `auto` requires the latest run for that workspace to have `passed = true`.
 */
export const aiEvalRuns = quillsSchema
  .table(
    "ai_eval_runs",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("ai_eval_run")("id").notNull(),
      channel: text("channel").notNull().default("all"),
      model: text("model").notNull(),
      promptHash: text("prompt_hash").notNull(),
      totalCases: integer("total_cases").notNull(),
      passedCases: integer("passed_cases").notNull(),
      groundingScore: real("grounding_score").notNull(),
      escalationScore: real("escalation_score").notNull(),
      declineScore: real("decline_score").notNull(),
      passed: boolean("passed").notNull(),
      details: jsonb("details").$type<EvalCaseDetail[]>().notNull().default([]),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      index("ai_eval_runs_workspace_created_idx").on(
        table.workspaceId,
        table.createdAt,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Isolated draft replies written when the customer agent runs in `draft` mode (#299).
 * Stored in a separate table from `conversation_messages` so an unapproved AI draft can NEVER
 * leak into any customer-facing message query.
 */
export const assistantDraftReplies = quillsSchema
  .table(
    "assistant_draft_replies",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("assistant_draft_reply")("id").notNull(),
      conversationId: typeIdColumn("conversation")("conversation_id").notNull(),
      triggerMessageId:
        typeIdColumnNullable("conversation_msg")("trigger_message_id"),
      content: text("content").notNull(),
      citations: jsonb("citations")
        .$type<ConversationMessageCitation[]>()
        .notNull()
        .default([]),
      confidence: real("confidence").notNull().default(0),
      status: text("status", { enum: ASSISTANT_DRAFT_STATUSES })
        .notNull()
        .default("pending"),
      sentMessageId:
        typeIdColumnNullable("conversation_msg")("sent_message_id"),
      reviewedByPrincipalId: typeIdColumnNullable("principal")(
        "reviewed_by_principal_id",
      ),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      foreignKey({
        name: "assistant_draft_replies_conversation_id_fkey",
        columns: [table.workspaceId, table.conversationId],
        foreignColumns: [conversations.workspaceId, conversations.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "assistant_draft_replies_trigger_message_id_fkey",
        columns: [table.workspaceId, table.triggerMessageId],
        foreignColumns: [
          conversationMessages.workspaceId,
          conversationMessages.id,
        ],
      }).onDelete("set null"),
      foreignKey({
        name: "assistant_draft_replies_sent_message_id_fkey",
        columns: [table.workspaceId, table.sentMessageId],
        foreignColumns: [
          conversationMessages.workspaceId,
          conversationMessages.id,
        ],
      }).onDelete("set null"),
      foreignKey({
        name: "assistant_draft_replies_reviewed_by_principal_id_fkey",
        columns: [table.workspaceId, table.reviewedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      index("assistant_draft_replies_conv_status_idx").on(
        table.workspaceId,
        table.conversationId,
        table.status,
      ),
      index("assistant_draft_replies_trigger_message_fk_idx")
        .on(table.workspaceId, table.triggerMessageId)
        .where(sql`"trigger_message_id" IS NOT NULL`),
      index("assistant_draft_replies_sent_message_fk_idx")
        .on(table.workspaceId, table.sentMessageId)
        .where(sql`"sent_message_id" IS NOT NULL`),
      index("assistant_draft_replies_reviewed_by_principal_fk_idx")
        .on(table.workspaceId, table.reviewedByPrincipalId)
        .where(sql`"reviewed_by_principal_id" IS NOT NULL`),
      check(
        "assistant_draft_replies_status_check",
        sql`${table.status} IN ('pending','sent','dismissed')`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
