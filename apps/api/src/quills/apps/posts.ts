import { eq } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { posts } from "../../database/quills/schema/posts";
import { identifyCustomer } from "../directory/identify-customer";
import { insertPost } from "../feedback/posts";
import { loadProjects } from "../feedback/visibility";
import {
  defineQuillsRoute,
  type QuillsChange,
} from "../framework/define-route";
import { externalKey, externalType, externalUrl, requester } from "./app-posts";

const createPost = defineQuillsRoute({
  audience: "app",
  capability: "write:feedback",
  method: "post",
  path: "/posts",
  operationId: "createQuillsAppPost",
  summary: "Create a post from a sidebar app",
  description:
    "The requester, when given, is identified as a customer and becomes the author and first voter; the key's owner is recorded as the teammate who tracks the post. Without a requester the key's owner is the author. With `link`, the external item is linked to the new post.",
  action: "create",
  body: z.object({
    boardId: flexibleToTypeIdSchema("board"),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().max(10000).default(""),
    link: z.object({ externalType, externalKey, externalUrl }).optional(),
    requester,
  }),
  response: z.object({
    id: z.string(),
    title: z.string(),
    boardId: z.string(),
    statusId: z.string().nullable(),
    voteCount: z.number(),
    authorPrincipalId: z.string(),
    createdAt: responseTimestamp,
    linkId: z.string().nullable(),
  }),
  responseDescription: "The created post",
  errors: {
    404: "Board not found",
    409: "The requester's email belongs to a teammate",
  },
  event: ({ body }, result) => {
    const post = { entityType: "post", entityId: result.id } as const;
    const changes: QuillsChange[] = [
      { type: "post.created", ...post, payload: { boardId: result.boardId } },
      {
        type: "app.post_created",
        ...post,
        payload: { boardId: result.boardId },
      },
    ];
    if (body.link)
      changes.push({
        type: "app.post_linked",
        ...post,
        payload: {
          externalType: body.link.externalType,
          externalKey: body.link.externalKey,
        },
      });
    if (body.requester)
      changes.push({
        type: "user.identified",
        entityType: "principal",
        entityId: result.authorPrincipalId,
      });
    return changes;
  },
  load: loadProjects,
  handler: async ({ db, actor, body, loaded: projects }) => {
    const author =
      body.requester && (await identifyCustomer(db, body.requester));
    const postId = await insertPost(db, actor, projects, {
      boardId: body.boardId,
      title: body.title,
      content: body.content,
      tagIds: [],
      author: author ? author.principalId : undefined,
    });
    const [link] = body.link
      ? await db
          .insert(postExternalLinks)
          .values({
            postId,
            integrationType: body.link.externalType,
            externalId: body.link.externalKey,
            externalUrl: body.link.externalUrl ?? null,
            origin: "sidebar",
            createdByPrincipalId: actor.principalId,
          })
          .returning({ id: postExternalLinks.id })
      : [];
    const [post] = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardId: posts.boardId,
        statusId: posts.statusId,
        voteCount: posts.voteCount,
        authorPrincipalId: posts.principalId,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .where(eq(posts.id, postId));
    return { ...post!, linkId: link?.id ?? null };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...createPost,
);
