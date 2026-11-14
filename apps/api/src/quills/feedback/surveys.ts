import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { SegmentId, SurveyId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { segments } from "../../database/quills/schema/segments";
import {
  SURVEY_TYPES,
  surveyResponses,
  surveys,
} from "../../database/quills/schema/surveys";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { idList, page, pageQuery, someField } from "./schemas";
import { PMF_OPTIONS, summarize, type SurveyType } from "./surveys-rules";

// Teammate routes for in-app surveys (RFC 0003, D8). A survey starts as a draft, goes active
// once, and closes once. Only a draft can be deleted; responses stay with a closed survey.

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const STATUSES = surveys.status.enumValues;
const survey = z
  .object({
    id: z.string(),
    type: z.enum(SURVEY_TYPES),
    question: z.string(),
    options: z.array(z.string()),
    targetSegmentIds: z.array(z.string()).nullable(),
    status: z.enum(STATUSES),
    responseCount: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsSurvey");
const fields = {
  id: surveys.id,
  type: surveys.type,
  question: surveys.question,
  options: surveys.options,
  targetSegmentIds: surveys.targetSegmentIds,
  status: surveys.status,
  createdAt: surveys.createdAt,
  updatedAt: surveys.updatedAt,
};
// ponytail: each read counts the responses of every listed survey (the unique index serves it);
// store a counter with a migration if surveys collect very many answers.
const columns = {
  ...fields,
  // Qualified by hand: a single-table select names its own columns without the table.
  responseCount: sql<number>`(select count(*)::int from ${surveyResponses} where ${surveyResponses.surveyId} = ${surveys}.${sql.identifier("id")})`,
};
const params = z.object({ surveyId: flexibleToTypeIdSchema("survey") });
const question = z.string().trim().min(1).max(500);
/** The answers of a poll. The database keeps the stored JSON at 4,000 bytes or less. */
const options = z
  .array(z.string().trim().min(1).max(200))
  .min(2)
  .max(20)
  .refine(
    (list) => new Set(list).size === list.length,
    "Each answer can appear only once",
  )
  .refine(
    (list) => Buffer.byteLength(JSON.stringify(list)) + list.length <= 4000,
    "The answers are too long",
  );
/** Null aims the survey at every customer. */
const targets = idList("segment").min(1).nullable();
const notFound = () => new HTTPException(404, { message: "Survey not found" });
const conflict = (message: string) => new HTTPException(409, { message });

/** Only a poll takes answers from the teammate; a PMF survey has fixed answers. */
function optionsFor(type: SurveyType, given?: string[]) {
  if (given !== undefined && type !== "poll")
    throw new HTTPException(400, {
      message: "Only a poll takes answer options",
    });
  if (type === "poll" && !given)
    throw new HTTPException(400, { message: "A poll needs answer options" });
  return type === "pmf" ? PMF_OPTIONS : (given ?? []);
}

/** Every target segment must be a live segment of this workspace. */
async function checkSegments(db: Db, ids: SegmentId[] | null | undefined) {
  if (!ids?.length) return;
  const [found] = await db
    .select({ n: count() })
    .from(segments)
    .where(and(inArray(segments.id, ids), isNull(segments.deletedAt)));
  if (found!.n !== ids.length)
    throw new HTTPException(404, { message: "Segment not found" });
}

/** The survey, locked for this transaction. 404 when it is missing. */
async function lockSurvey(db: Db, id: SurveyId) {
  const [row] = await db
    .select({ type: surveys.type, status: surveys.status })
    .from(surveys)
    .where(eq(surveys.id, id))
    .for("update");
  if (!row) throw notFound();
  return row;
}

const read = async (db: Db, id: SurveyId) =>
  (await db.select(columns).from(surveys).where(eq(surveys.id, id)))[0]!;

const listSurveys = defineQuillsRoute({
  method: "get",
  path: "/surveys",
  operationId: "listQuillsSurveys",
  summary: "List surveys",
  action: "read",
  query: z.object({ ...pageQuery, status: z.enum(STATUSES).optional() }),
  response: z.object({
    surveys: z.array(survey),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Surveys, newest first, with their response counts",
  handler: async ({ db, query }) => {
    const rows = await db
      .select(columns)
      .from(surveys)
      .where(query.status ? eq(surveys.status, query.status) : undefined)
      .orderBy(desc(surveys.createdAt), desc(surveys.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    const { items, nextOffset } = page(rows, query);
    return { surveys: items, nextOffset };
  },
});

const createSurvey = defineQuillsRoute({
  method: "post",
  path: "/surveys",
  operationId: "createQuillsSurvey",
  summary: "Create a draft survey",
  description:
    "A poll needs 2 to 20 answer options. A PMF survey gets its fixed answers. Other types take no options. targetSegmentIds null aims the survey at every customer.",
  action: "create",
  body: z.object({
    type: z.enum(SURVEY_TYPES),
    question,
    options: options.optional(),
    targetSegmentIds: targets.optional(),
  }),
  response: survey,
  responseDescription: "The created draft",
  errors: {
    400: "The options do not fit the survey type",
    404: "Segment not found",
  },
  event: (_input, result) => ({
    type: "survey.created",
    entityType: "survey",
    entityId: result.id,
  }),
  handler: async ({ db, actor, body }) => {
    const answers = optionsFor(body.type, body.options);
    await checkSegments(db, body.targetSegmentIds);
    const [row] = await db
      .insert(surveys)
      .values({
        type: body.type,
        question: body.question,
        options: answers,
        targetSegmentIds: body.targetSegmentIds ?? null,
        createdByPrincipalId: actor.principalId,
      })
      .returning({ id: surveys.id });
    return read(db, row!.id);
  },
});

const updateSurvey = defineQuillsRoute({
  method: "patch",
  path: "/surveys/{surveyId}",
  operationId: "updateQuillsSurvey",
  summary: "Update a draft or active survey",
  description:
    "Changes the question, the poll options or the target segments. A closed survey does not change.",
  action: "update",
  params,
  body: z
    .object({
      question: question.optional(),
      options: options.optional(),
      targetSegmentIds: targets.optional(),
    })
    .refine(someField, "Change at least one field"),
  response: survey,
  responseDescription: "The updated survey",
  errors: {
    400: "The options do not fit the survey type",
    404: "Survey or segment not found",
    409: "The survey is closed",
  },
  event: ({ params }) => ({
    type: "survey.updated",
    entityType: "survey",
    entityId: params.surveyId,
  }),
  handler: async ({ db, params, body }) => {
    const current = await lockSurvey(db, params.surveyId);
    if (current.status === "closed") throw conflict("The survey is closed");
    if (body.options !== undefined) optionsFor(current.type, body.options);
    await checkSegments(db, body.targetSegmentIds);
    await db
      .update(surveys)
      .set({
        question: body.question,
        options: body.options,
        targetSegmentIds: body.targetSegmentIds,
        updatedAt: new Date(),
      })
      .where(eq(surveys.id, params.surveyId));
    return read(db, params.surveyId);
  },
});

const setSurveyStatus = defineQuillsRoute({
  method: "put",
  path: "/surveys/{surveyId}/status",
  operationId: "setQuillsSurveyStatus",
  summary: "Activate or close a survey",
  description:
    "A draft becomes active, and an active survey closes. Other changes are refused.",
  action: "update",
  params,
  body: z.object({ status: z.enum(["active", "closed"]) }),
  response: survey,
  responseDescription: "The survey with its new status",
  errors: {
    404: "Survey not found",
    409: "The survey cannot move to this status",
  },
  event: ({ params, body }) =>
    body.status === "closed"
      ? {
          type: "survey.closed",
          entityType: "survey",
          entityId: params.surveyId,
        }
      : {
          type: "survey.updated",
          entityType: "survey",
          entityId: params.surveyId,
          payload: { status: "active" },
        },
  handler: async ({ db, params, body }) => {
    const current = await lockSurvey(db, params.surveyId);
    const from = body.status === "active" ? "draft" : "active";
    if (current.status !== from)
      throw conflict(`A ${current.status} survey cannot become ${body.status}`);
    // ponytail: updated_at doubles as the activation time for the customer's "latest survey";
    // add an activated_at column if edits to an active survey must not reorder it.
    await db
      .update(surveys)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(surveys.id, params.surveyId));
    return read(db, params.surveyId);
  },
});

const deleteSurvey = defineQuillsRoute({
  method: "delete",
  path: "/surveys/{surveyId}",
  operationId: "deleteQuillsSurvey",
  summary: "Delete a draft survey",
  action: "delete",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted draft",
  errors: { 404: "Survey not found", 409: "Only a draft can be deleted" },
  event: ({ params }) => ({
    type: "survey.deleted",
    entityType: "survey",
    entityId: params.surveyId,
  }),
  handler: async ({ db, params }) => {
    const current = await lockSurvey(db, params.surveyId);
    if (current.status !== "draft")
      throw conflict("Only a draft can be deleted");
    await db.delete(surveys).where(eq(surveys.id, params.surveyId));
    return { id: params.surveyId };
  },
});

const COMMENTS = 20;

const getSurveyResults = defineQuillsRoute({
  method: "get",
  path: "/surveys/{surveyId}/results",
  operationId: "getQuillsSurveyResults",
  summary: "Get the results of a survey",
  description:
    "Counts each score or choice and computes the type's score: NPS is % promoters (9-10) minus % detractors (0-6), CSAT is % of 4-5, CES is the average, PMF is % very disappointed. Also returns the latest 20 comments with the respondent's display name, which quills:read already shows in the people directory.",
  action: "read",
  params,
  response: z
    .object({
      survey,
      total: z.number(),
      score: z.number().nullable(),
      scores: z.array(z.object({ value: z.number(), count: z.number() })),
      choices: z.array(z.object({ label: z.string(), count: z.number() })),
      comments: z.array(
        z.object({
          id: z.string(),
          comment: z.string(),
          score: z.number().nullable(),
          choice: z.string().nullable(),
          respondent: z.string().nullable(),
          createdAt: responseTimestamp,
        }),
      ),
    })
    .openapi("QuillsSurveyResults"),
  responseDescription: "The survey and its results",
  errors: { 404: "Survey not found" },
  handler: async ({ db, params }) => {
    // The response count comes from the totals below, not from a second count.
    const [found] = await db
      .select(fields)
      .from(surveys)
      .where(eq(surveys.id, params.surveyId));
    if (!found) throw notFound();
    const mine = eq(surveyResponses.surveyId, params.surveyId);
    // A choice outside the current options (a poll that changed) counts only in the total.
    const counts = await db
      .select({
        score: surveyResponses.score,
        choice: sql<
          string | null
        >`case when ${surveyResponses.choice} = any(${sql.param(found.options)}::text[]) then ${surveyResponses.choice} end`,
        count: count(),
      })
      .from(surveyResponses)
      .where(mine)
      .groupBy(sql`1`, sql`2`);
    // The latest comments first, then their people: the join reads at most 20 rows.
    const latest = db
      .select({
        id: surveyResponses.id,
        comment: surveyResponses.comment,
        score: surveyResponses.score,
        choice: surveyResponses.choice,
        principalId: surveyResponses.principalId,
        createdAt: surveyResponses.createdAt,
      })
      .from(surveyResponses)
      .where(and(mine, isNotNull(surveyResponses.comment)))
      .orderBy(desc(surveyResponses.createdAt), desc(surveyResponses.id))
      .limit(COMMENTS)
      .as("latest");
    const comments = await db
      .select({
        id: latest.id,
        comment: sql<string>`${latest.comment}`,
        score: latest.score,
        choice: latest.choice,
        respondent: principal.displayName,
        createdAt: latest.createdAt,
      })
      .from(latest)
      .leftJoin(principal, eq(principal.id, latest.principalId))
      .orderBy(desc(latest.createdAt), desc(latest.id));
    const results = summarize(found, counts);
    return {
      survey: { ...found, responseCount: results.total },
      ...results,
      comments,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listSurveys)
  .openapi(...createSurvey)
  .openapi(...updateSurvey)
  .openapi(...setSurveyStatus)
  .openapi(...deleteSurvey)
  .openapi(...getSurveyResults);
