import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { postExternalLinks as links } from "../../database/quills/schema/external-links";
import { posts } from "../../database/quills/schema/posts";
import { identifyCustomer } from "../directory/identify-customer";
import { recordActivity } from "../feedback/activity";
import { findPost, loadProjects, visiblePost } from "../feedback/visibility";
import { addVote } from "../feedback/votes";
import {
  defineQuillsRoute,
  type QuillsChange,
} from "../framework/define-route";
import {
  appLinks,
  appPost,
  externalKey,
  externalType,
  externalUrl,
  requester,
  selectAppPosts,
  voteCountOf,
} from "./app-posts";

const item = { externalType, externalKey };
/** The app's links of one external item to one post. */
const sameItem = (
  postId: typeof links.$inferSelect.postId,
  value: { externalType: string; externalKey: string },
) =>
  and(
    appLinks,
    eq(links.postId, postId),
    eq(links.integrationType, value.externalType),
    eq(links.externalId, value.externalKey),
  );

const link = defineQuillsRoute({
  audience: "app",
  capability: "write:feedback",
  method: "put",
  path: "/links",
  operationId: "linkQuillsAppPost",
  summary: "Link an external item to a post",
  description:
    "Idempotent: `linked` is false when the link existed. With a requester, the requester is identified as a customer and votes on the post (or on the post it was merged into); the key's owner is recorded as the teammate who added the vote. A link to the same item that an integration owns is a 409.",
  action: "update",
  body: z.object({
    postId: flexibleToTypeIdSchema("post"),
    ...item,
    externalUrl,
    requester,
  }),
  response: z.object({
    linkId: z.string(),
    linked: z.boolean(),
    voted: z.boolean(),
    voteCount: z.number(),
    votedPostId: z.string().nullable(),
    voterPrincipalId: z.string().nullable(),
  }),
  responseDescription: "The link and the vote",
  errors: {
    404: "Post not found",
    409: "An integration owns this link, or the requester's email belongs to a teammate",
  },
  event: ({ body }, result) => {
    const changes: QuillsChange[] = [];
    if (result.linked)
      changes.push({
        type: "app.post_linked",
        entityType: "post",
        entityId: body.postId,
        payload: {
          externalType: body.externalType,
          externalKey: body.externalKey,
        },
      });
    if (result.voted && result.votedPostId && result.voterPrincipalId)
      changes.push({
        type: "post.voted",
        entityType: "post",
        entityId: result.votedPostId,
        payload: { principalId: result.voterPrincipalId },
      });
    if (result.voterPrincipalId)
      changes.push({
        type: "user.identified",
        entityType: "principal",
        entityId: result.voterPrincipalId,
      });
    return changes.length > 0 && changes;
  },
  load: loadProjects,
  handler: async ({ db, actor, body, loaded: projects }) => {
    const post = await findPost(db, body.postId, projects);
    const [inserted] = await db
      .insert(links)
      .values({
        postId: post.id,
        integrationType: body.externalType,
        externalId: body.externalKey,
        externalUrl: body.externalUrl ?? null,
        origin: "sidebar",
        createdByPrincipalId: actor.principalId,
      })
      .onConflictDoNothing()
      .returning({ id: links.id });
    const [existing] = inserted
      ? []
      : await db
          .select({ id: links.id })
          .from(links)
          .where(sameItem(post.id, body))
          .limit(1);
    const linkId = inserted?.id ?? existing?.id;
    if (!linkId)
      throw new HTTPException(409, {
        message: "An integration owns this link",
      });
    const linked = Boolean(inserted);
    if (!body.requester)
      return {
        linkId,
        linked,
        voted: false,
        voteCount: await voteCountOf(db, post.id),
        votedPostId: null,
        voterPrincipalId: null,
      };
    const { principalId } = await identifyCustomer(db, body.requester);
    const vote = await addVote(db, post.id, projects, principalId, actor);
    if (vote.changed) {
      const [voter] = await db
        .select({ name: principal.displayName })
        .from(principal)
        .where(eq(principal.id, principalId));
      await recordActivity(db, actor, vote.postId, {
        type: "vote.proxy",
        metadata: { voterPrincipalId: principalId, voterName: voter!.name },
      });
    }
    return {
      linkId,
      linked,
      voted: vote.changed,
      voteCount: vote.voteCount,
      votedPostId: vote.postId,
      voterPrincipalId: principalId,
    };
  },
});

const unlink = defineQuillsRoute({
  audience: "app",
  capability: "write:feedback",
  method: "delete",
  path: "/links",
  operationId: "unlinkQuillsAppPost",
  summary: "Unlink an external item from a post",
  description:
    "Idempotent. Removes only the app's link; a vote that the link added stays.",
  action: "update",
  query: z.object({ postId: flexibleToTypeIdSchema("post"), ...item }),
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a link was removed",
  errors: { 404: "Post not found" },
  event: ({ query }, result) =>
    result.changed && {
      type: "app.post_unlinked",
      entityType: "post",
      entityId: query.postId,
      payload: {
        externalType: query.externalType,
        externalKey: query.externalKey,
      },
    },
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => {
    const post = await findPost(db, query.postId, projects);
    const removed = await db
      .delete(links)
      .where(sameItem(post.id, query))
      .returning({ id: links.id });
    return { changed: removed.length > 0 };
  },
});

const linked = defineQuillsRoute({
  audience: "app",
  capability: "read:feedback",
  method: "get",
  path: "/links",
  operationId: "listQuillsAppLinkedPosts",
  summary: "List the posts linked to an external item",
  description:
    "The app's active links to visible posts, newest first, at most 100.",
  action: "read",
  query: z.object(item),
  response: z.object({
    items: z.array(
      appPost.extend({ linkId: z.string(), linkedAt: responseTimestamp }),
    ),
  }),
  responseDescription: "Linked posts",
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => ({
    items: await selectAppPosts(db, {
      linkId: links.id,
      linkedAt: links.createdAt,
    })
      .innerJoin(links, eq(links.postId, posts.id))
      .where(
        and(
          appLinks,
          eq(links.integrationType, query.externalType),
          eq(links.externalId, query.externalKey),
          eq(links.status, "active"),
          visiblePost(projects),
        ),
      )
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(100),
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...link)
  .openapi(...unlink)
  .openapi(...linked);
