import { and, desc, eq, notExists, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../openapi";
import {
  SURVEY_TYPES,
  surveyResponses,
  surveys,
} from "../../database/quills/schema/surveys";
import { defineQuillsRoute } from "../framework/define-route";
import { checkAnswer, SCALES } from "../feedback/surveys-rules";
import {
  principalOf,
  title,
  viewerFor,
  type Customer,
  type Viewer,
} from "./feedback/viewer";

// Customer survey routes, declared with audience "portal" here and "widget" in ../widget/surveys.
// Only a signed-in portal customer or an identified widget visitor sees a survey. A survey with
// target segments shows only to a member of one of them (user_segments, live segments only).

/** An active survey that aims at the viewer. */
function aimedAt(viewer: Viewer): SQL {
  return and(
    eq(surveys.status, "active"),
    viewer.segmentIds.length
      ? sql`(${surveys.targetSegmentIds} is null or ${surveys.targetSegmentIds} ?| ${sql.param(viewer.segmentIds)}::text[])`
      : sql`${surveys.targetSegmentIds} is null`,
  )!;
}

const activeSurvey = z
  .object({
    id: z.string(),
    type: z.enum(SURVEY_TYPES),
    question: z.string(),
    options: z.array(z.string()),
    scale: z
      .object({ min: z.number(), max: z.number() })
      .nullable()
      .openapi({ description: "The score scale; null for pmf, poll and open" }),
  })
  .openapi("QuillsCustomerSurvey");
const notFound = () => new HTTPException(404, { message: "Survey not found" });

export const surveyRoutes = (audience: Customer) =>
  apiRouter()
    .openapi(
      ...defineQuillsRoute({
        audience,
        method: "get",
        path: `/${audience}/surveys/active`,
        operationId: `getQuills${title(audience)}ActiveSurvey`,
        summary: "Get the survey that waits for the caller",
        description:
          "The most recently activated survey that aims at the caller and that the caller did not answer, or null. An anonymous widget visitor gets null.",
        action: "read",
        response: z.object({ survey: activeSurvey.nullable() }),
        responseDescription: "The survey, or null",
        handler: async ({ db, caller }) => {
          const viewer = await viewerFor(db, audience, caller);
          if (!viewer.signedIn) return { survey: null };
          const me = viewer.principalId;
          const unanswered = me
            ? notExists(
                db
                  .select({ one: sql`1` })
                  .from(surveyResponses)
                  .where(
                    and(
                      eq(surveyResponses.surveyId, surveys.id),
                      eq(surveyResponses.principalId, me),
                    ),
                  ),
              )
            : undefined;
          // ponytail: updated_at stands in for the activation time (see feedback/surveys.ts).
          const [row] = await db
            .select({
              id: surveys.id,
              type: surveys.type,
              question: surveys.question,
              options: surveys.options,
            })
            .from(surveys)
            .where(and(aimedAt(viewer), unanswered))
            .orderBy(desc(surveys.updatedAt), desc(surveys.id))
            .limit(1);
          return {
            survey: row ? { ...row, scale: SCALES[row.type] ?? null } : null,
          };
        },
      }),
    )
    .openapi(
      ...defineQuillsRoute({
        audience,
        ensureCustomer: audience === "portal",
        method: "post",
        path: `/${audience}/surveys/{surveyId}/responses`,
        operationId: `submitQuills${title(audience)}SurveyResponse`,
        summary: "Answer a survey",
        description:
          "One answer per person and survey. NPS takes a score of 0-10, CSAT 1-5 and CES 1-7; PMF and poll take one of the survey's options; open takes a comment. The comment is optional for the other types.",
        action: "create",
        rateLimit: { limit: 30, windowSeconds: 600 },
        params: z.object({ surveyId: flexibleToTypeIdSchema("survey") }),
        body: z.object({
          score: z.number().int().min(0).max(10).optional(),
          choice: z.string().trim().min(1).max(200).optional(),
          comment: z.string().trim().max(2000).optional(),
        }),
        response: z.object({ surveyId: z.string() }),
        responseDescription: "The answered survey",
        errors: {
          400: "The answer does not fit the survey type",
          404: "Survey not found",
          409: "The caller already answered this survey",
        },
        event: ({ params }) => ({
          type: "survey.responded",
          entityType: "survey",
          entityId: params.surveyId,
        }),
        handler: async ({ db, caller, params, body }) => {
          const viewer = await viewerFor(db, audience, caller);
          if (!viewer.signedIn) throw notFound();
          const [found] = await db
            .select({ type: surveys.type, options: surveys.options })
            .from(surveys)
            .where(and(eq(surveys.id, params.surveyId), aimedAt(viewer)));
          if (!found) throw notFound();
          const answer = checkAnswer(found, {
            score: body.score,
            choice: body.choice,
            comment: body.comment,
          });
          // The unique (survey, principal) index decides between two parallel answers.
          const [row] = await db
            .insert(surveyResponses)
            .values({
              surveyId: params.surveyId,
              principalId: principalOf(viewer),
              score: answer.score,
              choice: answer.choice,
              comment: answer.comment,
            })
            .onConflictDoNothing()
            .returning({ id: surveyResponses.id });
          if (!row)
            throw new HTTPException(409, {
              message: "You already answered this survey",
            });
          return { surveyId: params.surveyId };
        },
      }),
    );

export default surveyRoutes("portal");
