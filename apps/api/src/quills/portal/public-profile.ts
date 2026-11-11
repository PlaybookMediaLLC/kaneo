import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { postComments, posts } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import { visitorDevices } from "../../database/quills/schema/visitor-analytics";
import { defineQuillsRoute } from "../framework/define-route";
import { realEmail } from "../directory/customer";
import {
  commentVisible,
  httpUrl,
  postVisible,
  viewerFor,
  visibleBoards,
} from "./feedback/viewer";

// A person's public portal profile and the team-only context strip next to it. The public
// profile is a leak path: it holds public fields only, and only activity the caller can see.

const ACTIVITY_LIMIT = 100;
const params = z.object({ principalId: flexibleToTypeIdSchema("principal") });
const notFound = () => new HTTPException(404, { message: "Profile not found" });

/** A person a profile may show: a human with a portal role, not a test customer. */
const profileOwner = and(
  eq(principal.type, "user"),
  sql`${principal.role} in ('user', 'member', 'admin')`,
  isNull(principal.testOwnerPrincipalId),
);

const activityItem = z.object({
  postId: z.string(),
  title: z.string(),
  boardSlug: z.string(),
  statusName: z.string().nullable(),
  statusColor: z.string().nullable(),
  occurredAt: responseTimestamp,
});
const activityColumns = {
  postId: posts.id,
  title: posts.title,
  boardSlug: boards.slug,
  statusName: postStatuses.name,
  statusColor: postStatuses.color,
};

const publicProfile = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/profiles/{principalId}",
  operationId: "getQuillsPublicUserProfile",
  summary: "Get a person's public portal profile",
  description:
    "The display name, avatar, join date and the posts and comments that the caller can see. Never an email, a company or votes. 404 when the person is unknown, blocked, a test customer or has no activity that the caller can see.",
  action: "read",
  params,
  response: z.object({
    principalId: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    isTeamMember: z.boolean(),
    joinedAt: responseTimestamp,
    postCount: z.number(),
    commentCount: z.number(),
    posts: z.array(activityItem),
    comments: z.array(activityItem),
  }),
  responseDescription: "The public profile",
  errors: {
    403: "Portal access required",
    404: "Profile not found",
  },
  handler: async ({ db, caller, params }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const [owner] = await db
      .select({
        principalId: principal.id,
        displayName: sql<string>`coalesce(${principal.displayName}, ${customer.name}, '')`,
        avatarUrl: principal.avatarUrl,
        teammate: principal.kaneoUserId,
        joinedAt: principal.createdAt,
      })
      .from(principal)
      .leftJoin(customer, eq(customer.id, principal.userId))
      .where(
        and(
          eq(principal.id, params.principalId),
          profileOwner,
          isNull(principal.blockedAt),
        ),
      )
      .limit(1);
    if (!owner) throw notFound();
    const seen = postVisible(
      viewer,
      (await visibleBoards(db, viewer)).map((board) => board.id),
    );
    const authored = and(eq(posts.principalId, owner.principalId), seen);
    const commented = and(
      eq(postComments.principalId, owner.principalId),
      isNull(postComments.deletedAt),
      commentVisible(viewer),
      seen,
    );
    const [postCount] = await db
      .select({ n: count() })
      .from(posts)
      .where(authored);
    const [commentCount] = await db
      .select({ n: countDistinct(postComments.postId) })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .where(commented);
    // No activity the caller can see: the answer is the one for an unknown person.
    if (!postCount!.n && !commentCount!.n) throw notFound();
    const latestComment = sql<Date>`max(${postComments.createdAt})`.mapWith(
      postComments.createdAt,
    );
    return {
      principalId: owner.principalId,
      displayName: owner.displayName,
      avatarUrl: httpUrl(owner.avatarUrl),
      isTeamMember: owner.teammate !== null,
      joinedAt: owner.joinedAt,
      postCount: postCount!.n,
      commentCount: commentCount!.n,
      posts: await db
        .select({ ...activityColumns, occurredAt: posts.createdAt })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(authored)
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(ACTIVITY_LIMIT),
      comments: await db
        .select({ ...activityColumns, occurredAt: latestComment })
        .from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(commented)
        .groupBy(
          posts.id,
          posts.title,
          boards.slug,
          postStatuses.name,
          postStatuses.color,
        )
        .orderBy(desc(latestComment), desc(posts.id))
        .limit(ACTIVITY_LIMIT),
    };
  },
});

const teamContext = defineQuillsRoute({
  method: "get",
  path: "/profiles/{principalId}/team-context",
  operationId: "getQuillsProfileTeamContext",
  summary: "Get the team context of a profile",
  description:
    "The email, company, segments, last device visit and the verified and blocked flags of a person with a profile. A teammate's email is Kaneo's and is null here.",
  action: "read",
  params,
  response: z.object({
    email: z.string().nullable(),
    company: z
      .object({
        id: z.string(),
        name: z.string(),
        plan: z.string().nullable(),
        mrrCents: z.number().nullable(),
      })
      .nullable(),
    segments: z.array(
      z.object({ id: z.string(), name: z.string(), color: z.string() }),
    ),
    lastSeenAt: nullableResponseTimestamp,
    emailVerified: z.boolean(),
    blocked: z.boolean(),
  }),
  responseDescription: "The team context",
  errors: { 404: "Profile not found" },
  handler: async ({ db, params }) => {
    const [row] = await db
      .select({
        email: customer.email,
        contactEmail: principal.contactEmail,
        emailVerified: customer.emailVerified,
        blockedAt: principal.blockedAt,
        companyId: companies.id,
        companyName: companies.name,
        companyPlan: companies.plan,
        companyMrrCents: companies.mrrCents,
        // Kaneo owns sessions, so the last visit is the person's latest widget or portal device.
        lastSeenAt:
          sql<Date | null>`(select max(d.last_seen_at) from ${visitorDevices} d where d.principal_id = ${principal}.id)`.mapWith(
            visitorDevices.lastSeenAt,
          ),
      })
      .from(principal)
      .leftJoin(customer, eq(customer.id, principal.userId))
      .leftJoin(companies, eq(companies.id, principal.companyId))
      .where(and(eq(principal.id, params.principalId), profileOwner))
      .limit(1);
    if (!row) throw notFound();
    return {
      email: realEmail(row.email) ?? realEmail(row.contactEmail),
      company: row.companyId
        ? {
            id: row.companyId,
            name: row.companyName!,
            plan: row.companyPlan,
            mrrCents: row.companyMrrCents,
          }
        : null,
      segments: await db
        .select({ id: segments.id, name: segments.name, color: segments.color })
        .from(userSegments)
        .innerJoin(segments, eq(segments.id, userSegments.segmentId))
        .where(
          and(
            eq(userSegments.principalId, params.principalId),
            isNull(segments.deletedAt),
          ),
        )
        .orderBy(asc(segments.name), asc(segments.id))
        // ponytail: the first 100 segments by name; page them if a person can hold more.
        .limit(100),
      lastSeenAt: row.lastSeenAt,
      emailVerified: row.emailVerified === true,
      blocked: row.blockedAt !== null,
    };
  },
});

/** Portal route, mounted under /quills-public by ./index.ts. */
export default apiRouter().openapi(...publicProfile);

/** Teammate route, mounted under /quills by ../index.ts. */
export const profileTeamContext = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(...teamContext);
