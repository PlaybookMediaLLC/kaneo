// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
// The customer view of feedback, shared by audience: "portal" and audience: "widget" routes.
// A teammate on these routes is a customer. Board project links, the "team" tier, private and
// pending content of others, deleted rows and test-customer content never reach a customer.
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { BoardId, PostId, PrincipalId } from "@kaneo/ids";
import { postActivity } from "../../../database/quills/schema/activity";
import { principal, settings } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import { postComments, posts } from "../../../database/quills/schema/posts";
import {
  segments,
  userSegments,
} from "../../../database/quills/schema/segments";
import { postStatuses } from "../../../database/quills/schema/statuses";
import {
  evaluatePortalAccess,
  widgetEnabled,
  type QuillsCaller,
} from "../../framework/audience";
import type { Database } from "../../framework/define-route";
import { votingOf } from "../../feedback/board-voting";
import { notFound, notTest } from "../../feedback/visibility";
import { bool, parseJson, record, str } from "../../settings/area";

export type Customer = "portal" | "widget";
export const title = (audience: Customer) =>
  audience === "portal" ? "Portal" : "Widget";

/** 404 with the unknown-workspace message, so a closed portal looks like no portal. */
const closed = () => new HTTPException(404, { message: "Workspace not found" });
export const forbidden = (message: string) =>
  new HTTPException(403, { message });

/** Portals are opt-in: every portal and public route calls this first. */
export async function requirePortal(db: Database) {
  const [row] = await db
    .select({ portalConfig: settings.portalConfig })
    .from(settings)
    .limit(1);
  const config = parseJson(row?.portalConfig ?? null);
  if (config.enabled !== true) throw closed();
  return config;
}

export type Viewer = Awaited<ReturnType<typeof viewerFor>>;

/**
 * The caller as a customer. Portal: the portal is on and its private-portal gate admits the
 * caller (403 otherwise). Widget: the widget is on, and on a private portal only a visitor that
 * the host app identified reads (an anonymous widget session is 403). Never reads input.
 */
export async function viewerFor(
  db: Database,
  audience: Customer,
  caller: QuillsCaller,
) {
  const [row] = await db
    .select({
      portalConfig: settings.portalConfig,
      widgetConfig: settings.widgetConfig,
      metadata: settings.metadata,
    })
    .from(settings)
    .limit(1);
  const config = parseJson(row?.portalConfig ?? null);
  const me = caller.principalId;
  const [person] = me
    ? await db
        .select({ type: principal.type, test: principal.testOwnerPrincipalId })
        .from(principal)
        .where(eq(principal.id, me))
    : [];
  if (audience === "portal") {
    if (config.enabled !== true) throw closed();
    if (!(await evaluatePortalAccess(db, caller)).granted)
      throw forbidden("Portal access required");
  } else {
    if (!widgetEnabled(row?.widgetConfig ?? null)) throw closed();
    if (
      record(config.access).visibility === "private" &&
      person?.type !== "user"
    )
      throw forbidden("Portal access required");
  }
  const segmentIds = me
    ? (
        await db
          .select({ id: userSegments.segmentId })
          .from(userSegments)
          .innerJoin(segments, eq(segments.id, userSegments.segmentId))
          .where(
            and(eq(userSegments.principalId, me), isNull(segments.deletedAt)),
          )
      ).map((s) => String(s.id))
    : [];
  const features = record(config.features);
  const moderation = record(config.moderationDefault);
  return {
    audience,
    principalId: me,
    /** The "authenticated" tier: a signed-in portal account or an identified widget visitor. */
    signedIn:
      audience === "portal" ? !!caller.account : person?.type === "user",
    isTest: !!person?.test,
    segmentIds,
    // A missing flag denies anonymous interaction, as in the source.
    allowAnonymous: features.allowAnonymous === true,
    allowEdit: bool(features.allowEditAfterEngagement, false),
    allowDelete: bool(features.allowDeleteAfterEngagement, false),
    requireApproval: str(moderation.requireApproval) ?? "none",
    holdLinks: bool(moderation.holdLinks, false),
    changelogPublic:
      record(parseJson(row?.metadata ?? null).changelogSettings).audience !==
      "authenticated",
  };
}

/** The principal of a write route: the framework already required a session. */
export const principalOf = (viewer: Viewer): PrincipalId => viewer.principalId!;

const TIERS = ["anonymous", "authenticated", "segments", "team"] as const;
type Tier = (typeof TIERS)[number];
const tierOf = (value: unknown, fallback: Tier): Tier =>
  TIERS.includes(value as Tier) ? (value as Tier) : fallback;
const idsOf = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
const ruleOf = (value: unknown) =>
  value === "on" || value === "off" ? value : "inherit";

/** The stored access matrix with the teammate read defaults: a missing view tier is "team". */
export function accessOf(raw: unknown) {
  const a = record(raw);
  const s = record(a.segments);
  const m = record(a.moderation);
  const view = tierOf(a.view, "team");
  const submit = tierOf(a.submit, view);
  return {
    view,
    submit,
    vote: tierOf(a.vote, submit),
    comment: tierOf(a.comment, submit),
    segments: {
      view: idsOf(s.view),
      submit: idsOf(s.submit),
      vote: idsOf(s.vote),
      comment: idsOf(s.comment),
    },
    moderation: {
      anonPosts: ruleOf(m.anonPosts),
      signedPosts: ruleOf(m.signedPosts),
      comments: ruleOf(m.comments),
    },
    authorOnly: a.replyPolicy === "author-only",
  };
}
type Access = ReturnType<typeof accessOf>;
type Action = "view" | "submit" | "vote" | "comment";

/** The source's tierAllows for a customer: the team tier never admits one. */
export function allows(viewer: Viewer, access: Access, action: Action) {
  const tier = access[action];
  if (tier === "anonymous") return true;
  if (tier === "authenticated") return viewer.signedIn;
  if (tier === "segments")
    return (
      viewer.signedIn &&
      access.segments[action].some((id) => viewer.segmentIds.includes(id))
    );
  return false;
}

/**
 * What the caller can do on a board it sees. Without sign-in only the widget writes (through an
 * anonymous session), and only while the workspace allows anonymous interaction.
 */
export function capabilities(viewer: Viewer, access: Access) {
  const writes =
    viewer.signedIn || (viewer.audience === "widget" && viewer.allowAnonymous);
  return {
    canSubmit: writes && allows(viewer, access, "submit"),
    canVote: writes && allows(viewer, access, "vote"),
    canComment: writes && allows(viewer, access, "comment"),
  };
}

export type Board = Awaited<ReturnType<typeof visibleBoards>>[number];

/** Live boards without project links whose view tier admits the caller, by name. */
export async function visibleBoards(db: Database, viewer: Viewer) {
  // ponytail: reads every live board per request; add a SQL tier filter if workspaces grow past hundreds of boards.
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      slug: boards.slug,
      description: boards.description,
      access: boards.access,
      settings: boards.settings,
    })
    .from(boards)
    .where(
      and(
        isNull(boards.deletedAt),
        sql`not exists (select 1 from ${boardProjects} where ${eq(boardProjects.boardId, boards.id)})`,
      ),
    )
    .orderBy(asc(boards.name), asc(boards.id));
  // Only the voting keys leave the settings JSON; the other keys stay on the server.
  return rows
    .map(({ settings, ...row }) => ({
      ...row,
      access: accessOf(row.access),
      voting: votingOf(settings),
    }))
    .filter((board) => allows(viewer, board.access, "view"));
}

/** `{ voteCount }`, or nothing when the board hides vote counts from customers (RFC 0003, D6). */
export const shownVotes = (
  board: Pick<Board, "voting"> | undefined,
  voteCount: number,
) => (board?.voting.voteDisplay === "hidden" ? {} : { voteCount });

const own = (viewer: Viewer, column: AnyColumn) =>
  viewer.principalId ? eq(column, viewer.principalId) : sql`false`;

/** A post the caller may see: on a visible board, live, published or its own pending, not test data. */
export function postVisible(viewer: Viewer, boardIds: BoardId[]): SQL {
  const mine = own(viewer, posts.principalId);
  return and(
    boardIds.length ? inArray(posts.boardId, boardIds) : sql`false`,
    isNull(posts.deletedAt),
    or(
      eq(posts.moderationState, "published"),
      and(eq(posts.moderationState, "pending"), mine),
    ),
    or(notTest(posts.principalId), mine),
  )!;
}

/** A comment the caller may see on a visible post: public, published or its own pending, not test data. */
export function commentVisible(viewer: Viewer): SQL {
  const mine = own(viewer, postComments.principalId);
  return and(
    eq(postComments.isPrivate, false),
    or(
      eq(postComments.moderationState, "published"),
      and(eq(postComments.moderationState, "pending"), mine),
    ),
    or(notTest(postComments.principalId), mine),
  )!;
}

/** A visible post with its board. 404 otherwise, so a hidden post looks like a missing one. */
export async function findPost(
  db: Database,
  viewer: Viewer,
  boardList: Board[],
  id: PostId,
) {
  const [post] = await db
    .select({
      id: posts.id,
      boardId: posts.boardId,
      title: posts.title,
      content: posts.content,
      principalId: posts.principalId,
      statusId: posts.statusId,
      isCommentsLocked: posts.isCommentsLocked,
      canonicalPostId: posts.canonicalPostId,
      moderationState: posts.moderationState,
    })
    .from(posts)
    .where(
      and(
        eq(posts.id, id),
        postVisible(
          viewer,
          boardList.map((b) => b.id),
        ),
      ),
    )
    .limit(1);
  if (!post) throw notFound("Post");
  return { ...post, board: boardList.find((b) => b.id === post.boardId)! };
}

type Axis = "anonPosts" | "signedPosts" | "comments";
// ponytail: plain-text link detection; the source parses rich content and ignores its own origin.
const LINK = /https?:\/\/|www\./i;

/** True when a new post or comment waits for review: the board rule, else the workspace default. */
export function held(
  viewer: Viewer,
  access: Access,
  kind: "post" | "comment",
  text: string,
) {
  const axis: Axis =
    kind === "comment"
      ? "comments"
      : viewer.signedIn
        ? "signedPosts"
        : "anonPosts";
  const rule = access.moderation[axis];
  const level = viewer.requireApproval;
  const byDefault =
    level === "all" ||
    (axis === "anonPosts" && level === "anonymous") ||
    (axis === "signedPosts" && level === "authenticated");
  return (
    rule === "on" ||
    (rule === "inherit" && byDefault) ||
    (viewer.holdLinks && LINK.test(text))
  );
}

export const STAGES = ["open", "planned", "in_progress", "shipped"] as const;

/** The widget's public status vocabulary, mapped from the stored slug and category. */
export const stageOf = (
  status: { slug: string; category: string } | null | undefined,
) => {
  if (!status) return "open" as const;
  if (status.category === "complete") return "shipped" as const;
  if (status.category === "closed") return null;
  if (status.slug === "planned") return "planned" as const;
  if (status.slug === "in_progress") return "in_progress" as const;
  return "open" as const;
};

/** The live default status, or null. */
export async function defaultStatus(db: Database) {
  const [status] = await db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .where(
      and(eq(postStatuses.isDefault, true), isNull(postStatuses.deletedAt)),
    )
    .orderBy(asc(postStatuses.position))
    .limit(1);
  return status?.id ?? null;
}

/** One post activity row by a customer, in the request transaction. */
export const activity = (
  db: Database,
  principalId: PrincipalId,
  postId: PostId,
  type: string,
  metadata: Record<string, string> = {},
) => db.insert(postActivity).values({ postId, principalId, type, metadata });

export const httpUrl = (value: string | null) =>
  value && /^https?:\/\//i.test(value) ? value : null;
