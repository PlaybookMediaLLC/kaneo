import { and, eq, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { ticketPosts } from "../../database/quills/schema/releases";
import { tickets } from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import { insertPost } from "../feedback/posts";
import { addVote } from "../feedback/votes";
import { loadProjects } from "../feedback/visibility";

// Ticket to feedback (#73): a teammate records the ticket requester's request as a new post, or as
// the requester's vote on a post. The requester comes from the stored ticket, never from the request.

const createPost = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/posts",
  operationId: "createQuillsPostFromTicket",
  summary: "Record a ticket's request as feedback",
  description:
    "Creates a post by the ticket's requester on a visible board, or with asUpvoteOfPostId adds the requester's vote to a visible post. As for every request that you record for a customer: the requester is the author and first voter and is subscribed as the author, a vote does not subscribe, a person has one vote per post, and the post history and the audit log record you, the requester and the source `ticket`. Needs the create and update actions. 409 when the ticket has no customer requester.",
  action: "create",
  // Acting for a customer needs update too, as createQuillsPost and addQuillsPostProxyVote do.
  alsoRequires: ["update"],
  params: z.object({ ticketId: flexibleToTypeIdSchema("ticket") }),
  body: z
    .object({
      boardId: flexibleToTypeIdSchema("board").optional(),
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().trim().max(10000).default(""),
      asUpvoteOfPostId: flexibleToTypeIdSchema("post").optional(),
    })
    .refine((b) => b.asUpvoteOfPostId || (b.boardId && b.title), {
      message: "Provide boardId and title, or asUpvoteOfPostId",
    }),
  response: z.object({
    postId: z.string(),
    created: z.boolean(),
    voted: z.boolean().openapi({
      description: "False when the requester had already voted on the post.",
    }),
  }),
  responseDescription: "The post that holds the request",
  errors: {
    404: "Ticket, board or post not found",
    409: "The ticket has no customer requester",
  },
  event: ({ params, body }, result, raw) =>
    (result.created || result.voted) && {
      type: result.created ? "post.created" : "post.voted",
      entityType: "post",
      entityId: result.postId,
      payload: {
        ...(result.created && { boardId: body.boardId! }),
        ...(result.voted && {
          principalId: (raw as { onBehalfOf: string }).onBehalfOf,
        }),
        onBehalfOf: (raw as { onBehalfOf: string }).onBehalfOf,
        source: "ticket",
        ticketId: params.ticketId,
      },
    },
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    // A live ticket whose requester is a real customer: not a teammate, a service or a test customer.
    const [customer] = await db
      .select({ id: principal.id })
      .from(tickets)
      .innerJoin(principal, eq(principal.id, tickets.requesterPrincipalId))
      .where(
        and(
          eq(tickets.id, params.ticketId),
          isNull(tickets.deletedAt),
          isNull(principal.kaneoUserId),
          isNull(principal.testOwnerPrincipalId),
          ne(principal.type, "service"),
        ),
      );
    if (!customer) {
      const [ticket] = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.id, params.ticketId), isNull(tickets.deletedAt)));
      throw ticket
        ? new HTTPException(409, {
            message: "The ticket has no customer requester",
          })
        : new HTTPException(404, { message: "Ticket not found" });
    }
    if (body.asUpvoteOfPostId) {
      const vote = await addVote(
        db,
        body.asUpvoteOfPostId,
        projects,
        customer.id,
        actor,
        "ticket",
      );
      await db
        .insert(ticketPosts)
        .values({
          ticketId: params.ticketId,
          postId: vote.postId,
          createdByPrincipalId: actor.principalId,
        })
        .onConflictDoNothing();
      return {
        postId: vote.postId,
        created: false,
        voted: vote.changed,
        onBehalfOf: customer.id,
      };
    }
    const postId = await insertPost(db, actor, projects, {
      boardId: body.boardId!,
      title: body.title!,
      content: body.content,
      tagIds: [],
      author: customer.id,
      source: "ticket",
    });
    await db
      .insert(ticketPosts)
      .values({
        ticketId: params.ticketId,
        postId,
        createdByPrincipalId: actor.principalId,
      })
      .onConflictDoNothing();
    return { postId, created: true, voted: false, onBehalfOf: customer.id };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...createPost,
);
