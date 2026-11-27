import { desc } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  RELEASE_SOURCES,
  VERIFIED_RELEASE_STATUSES,
  verifiedReleases,
} from "../../database/quills/schema/releases";
import { defineQuillsRoute } from "../framework/define-route";
import {
  approveAndShipRelease,
  createVerifiedReleaseDraft,
} from "./draft-and-ship";

const verifiedReleaseSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  source: z.enum(RELEASE_SOURCES),
  externalUrl: z.string().nullable(),
  commitSha: z.string().nullable(),
  taskIds: z.array(z.string()),
  postIds: z.array(z.string()),
  ticketIds: z.array(z.string()),
  changelogEntryId: z.string().nullable(),
  status: z.enum(VERIFIED_RELEASE_STATUSES),
  verifiedAt: responseTimestamp,
  approvedAt: nullableResponseTimestamp,
  shippedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});

const listReleases = defineQuillsRoute({
  method: "get",
  path: "/releases",
  operationId: "listQuillsVerifiedReleases",
  summary: "List verified releases and their approval/shipped status",
  action: "read",
  response: z.object({ items: z.array(verifiedReleaseSchema) }),
  responseDescription: "Verified releases for this workspace",
  handler: async ({ db }) => {
    const items = await db
      .select()
      .from(verifiedReleases)
      .orderBy(desc(verifiedReleases.verifiedAt), desc(verifiedReleases.id))
      .limit(50);
    return { items };
  },
});

const verifyRelease = defineQuillsRoute({
  method: "post",
  path: "/releases/verify",
  operationId: "createQuillsVerifiedRelease",
  summary:
    "Record a verified release and draft its approval-pending changelog entry",
  description:
    "Creates a verified release in `draft` status with an unpublished changelog draft linking every affected feedback post and support ticket. Sends zero customer notifications until approved.",
  action: "manage_settings",
  body: z.object({
    version: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200).optional(),
    source: z.enum(RELEASE_SOURCES).default("manual"),
    externalUrl: z.string().url().max(2000).nullable().optional(),
    commitSha: z.string().trim().max(128).nullable().optional(),
    taskIds: z.array(z.string().min(1).max(200)).max(200).default([]),
    postIds: z.array(flexibleToTypeIdSchema("post")).max(200).default([]),
    ticketIds: z.array(flexibleToTypeIdSchema("ticket")).max(200).default([]),
  }),
  response: z.object({
    release: verifiedReleaseSchema,
    created: z.boolean(),
  }),
  responseDescription: "The verified release draft",
  event: (_input, result) =>
    result.created && {
      type: "release.verified",
      entityType: "verified_release",
      entityId: result.release.id,
      payload: {
        version: result.release.version,
        source: result.release.source,
      },
    },
  handler: async ({ db, actor, body }) =>
    createVerifiedReleaseDraft(db, {
      version: body.version,
      title: body.title,
      source: body.source,
      externalUrl: body.externalUrl ?? null,
      commitSha: body.commitSha ?? null,
      taskIds: body.taskIds,
      extraPostIds: body.postIds,
      extraTicketIds: body.ticketIds,
      authorPrincipalId: actor.principalId,
    }),
});

const approveRelease = defineQuillsRoute({
  method: "post",
  path: "/releases/{releaseId}/approve",
  operationId: "approveQuillsVerifiedRelease",
  summary:
    "Approve and ship a verified release, closing linked items and notifying requesters once",
  description:
    "Publishes the release changelog, moves linked feedback posts to shipped, closes linked open support tickets, and sends one deduplicated personal update per customer quoting their original request.",
  action: "manage_settings",
  params: z.object({
    releaseId: flexibleToTypeIdSchema("verified_release"),
  }),
  body: z.object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50_000).optional(),
  }),
  response: z.object({
    release: verifiedReleaseSchema,
    shippedPostCount: z.number().int(),
    closedTicketCount: z.number().int(),
    notifiedCount: z.number().int(),
  }),
  responseDescription: "Shipped release summary and delivery counts",
  errors: {
    404: "Verified release not found",
    409: "Release was already shipped",
  },
  event: ({ params }, result) => ({
    type: "release.shipped",
    entityType: "verified_release",
    entityId: params.releaseId,
    payload: {
      version: result.release.version,
      notifiedCount: String(result.notifiedCount),
    },
  }),
  handler: async ({ db, actor, params, body }) =>
    approveAndShipRelease(db, actor, params.releaseId, {
      title: body.title,
      content: body.content,
    }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listReleases)
  .openapi(...verifyRelease)
  .openapi(...approveRelease);
