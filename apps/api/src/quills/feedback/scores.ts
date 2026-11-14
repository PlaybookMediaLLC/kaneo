import { eq } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { posts } from "../../database/quills/schema/posts";
import { defineQuillsRoute } from "../framework/define-route";
import { loadPost, postSchema } from "./post-view";
import { findPost, loadProjects } from "./visibility";

// RICE inputs of a post (RFC 0003, D5). The table checks the same bounds.
const score = z.object({
  reach: z
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .nullable()
    .openapi({ description: "People or events in a period" }),
  impact: z
    .union([
      z.literal(0.25),
      z.literal(0.5),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ])
    .nullable()
    .openapi({
      description: "0.25 minimal, 0.5 low, 1 medium, 2 high, 3 massive",
    }),
  confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .openapi({ description: "Percent" }),
  effort: z
    .number()
    .min(0.01)
    .max(10000)
    .nullable()
    .openapi({ description: "Person-weeks" }),
});

const setScore = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/score",
  operationId: "setQuillsPostScore",
  summary: "Set a post's RICE inputs",
  description:
    "Desired state: send all four inputs. Null clears one. The response has the score with its RICE value.",
  action: "update",
  params: z.object({ postId: flexibleToTypeIdSchema("post") }),
  body: score,
  response: postSchema,
  responseDescription: "Updated post",
  errors: { 404: "Post not found" },
  event: ({ params }) => ({
    type: "post.scored",
    entityType: "post",
    entityId: params.postId,
  }),
  load: loadProjects,
  handler: async ({ db, params, body, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    await db
      .update(posts)
      .set({
        scoreReach: body.reach,
        scoreImpact: body.impact,
        scoreConfidence: body.confidence,
        scoreEffort: body.effort,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
    return loadPost(db, post.id);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...setScore,
);
