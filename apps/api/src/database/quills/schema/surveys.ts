import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
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

export const SURVEY_TYPES = [
  "nps",
  "csat",
  "ces",
  "pmf",
  "poll",
  "open",
] as const;

/** An in-app survey (RFC 0003, D8). Null target segments means every customer. */
export const surveys = quillsSchema
  .table(
    "surveys",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("survey")("id").notNull(),
      type: text("type", { enum: SURVEY_TYPES }).notNull(),
      question: text("question").notNull(),
      /** The answer labels of a poll or a PMF survey. */
      options: jsonb("options").$type<string[]>().notNull().default([]),
      targetSegmentIds: jsonb("target_segment_ids").$type<string[] | null>(),
      status: text("status", { enum: ["draft", "active", "closed"] })
        .notNull()
        .default("draft"),
      createdByPrincipalId: typeIdColumnNullable("principal")(
        "created_by_principal_id",
      ),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      // The active survey for a customer, and the teammate list by status.
      index("surveys_status_created_idx").on(
        table.workspaceId,
        table.status,
        table.createdAt,
      ),
      index("surveys_created_by_principal_id_fk_idx")
        .on(table.workspaceId, table.createdByPrincipalId)
        .where(sql`${table.createdByPrincipalId} IS NOT NULL`),
      check(
        "surveys_type_check",
        sql`${table.type} IN ('nps','csat','ces','pmf','poll','open')`,
      ),
      check(
        "surveys_status_check",
        sql`${table.status} IN ('draft','active','closed')`,
      ),
      check(
        "surveys_question_check",
        sql`char_length(${table.question}) BETWEEN 1 AND 500`,
      ),
      check(
        "surveys_options_check",
        sql`jsonb_typeof(${table.options}) = 'array' AND jsonb_array_length(${table.options}) <= 20 AND octet_length(${table.options}::text) <= 4000`,
      ),
      check(
        "surveys_target_segment_ids_array_check",
        sql`${table.targetSegmentIds} IS NULL OR jsonb_typeof(${table.targetSegmentIds}) = 'array'`,
      ),
      foreignKey({
        name: "surveys_created_by_principal_fk",
        columns: [table.workspaceId, table.createdByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/** One answer for each customer and survey. A score is 0 to 10 for every type. */
export const surveyResponses = quillsSchema
  .table(
    "survey_responses",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("survey_response")("id").notNull(),
      surveyId: typeIdColumn("survey")("survey_id").notNull(),
      principalId: typeIdColumn("principal")("principal_id").notNull(),
      score: integer("score"),
      choice: text("choice"),
      comment: text("comment"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("survey_responses_survey_principal_idx").on(
        table.workspaceId,
        table.surveyId,
        table.principalId,
      ),
      index("survey_responses_principal_id_fk_idx").on(
        table.workspaceId,
        table.principalId,
      ),
      check(
        "survey_responses_score_check",
        sql`${table.score} IS NULL OR ${table.score} BETWEEN 0 AND 10`,
      ),
      check(
        "survey_responses_choice_check",
        sql`${table.choice} IS NULL OR char_length(${table.choice}) BETWEEN 1 AND 200`,
      ),
      check(
        "survey_responses_comment_check",
        sql`${table.comment} IS NULL OR char_length(${table.comment}) <= 2000`,
      ),
      foreignKey({
        name: "survey_responses_survey_fk",
        columns: [table.workspaceId, table.surveyId],
        foreignColumns: [surveys.workspaceId, surveys.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "survey_responses_principal_fk",
        columns: [table.workspaceId, table.principalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
