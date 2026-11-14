import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import { boards } from "../../../database/quills/schema/boards";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import {
  segments,
  userSegments,
} from "../../../database/quills/schema/segments";
import { postStatuses } from "../../../database/quills/schema/statuses";

type PrincipalId = QuillsActor["principalId"];
const boardPosts = [
  "An audit log export for compliance reviews",
  "Seat-based billing for each department",
  "Data residency in the European Union",
];

/** Two manual segments, and a board that only the Enterprise segment can see. */
export async function seedShowcaseSegments(
  db: Database,
  customers: PrincipalId[],
) {
  await db
    .insert(segments)
    .values([
      {
        name: "Enterprise",
        slug: "enterprise",
        color: "#6366f1",
        description: "Customers on an annual enterprise plan.",
      },
      {
        name: "Beta program",
        slug: "beta-program",
        color: "#10b981",
        description: "Customers who test new features early.",
      },
    ])
    .onConflictDoNothing();
  const rows = await db
    .select({ id: segments.id, slug: segments.slug })
    .from(segments)
    .where(
      and(
        inArray(segments.slug, ["enterprise", "beta-program"]),
        isNull(segments.deletedAt),
      ),
    );
  const id = (slug: string) => rows.find((row) => row.slug === slug)!.id;
  const enterprise = customers.slice(0, 24);
  await db
    .insert(userSegments)
    .values([
      ...enterprise.map((principalId) => ({
        principalId,
        segmentId: id("enterprise"),
      })),
      ...customers.slice(24, 48).map((principalId) => ({
        principalId,
        segmentId: id("beta-program"),
      })),
    ])
    .onConflictDoNothing();

  let [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.slug, "enterprise-requests"));
  if (!board)
    [board] = await db
      .insert(boards)
      .values({
        name: "Enterprise requests",
        slug: "enterprise-requests",
        description: "Requests that only the Enterprise segment can see.",
        visibleSegmentIds: [id("enterprise")],
      })
      .returning({ id: boards.id });
  const [open] = await db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .where(and(eq(postStatuses.slug, "open"), isNull(postStatuses.deletedAt)));
  for (const [index, title] of boardPosts.entries()) {
    const voters = enterprise.slice(0, 9 - index * 3);
    const [post] = await db
      .insert(posts)
      .values({
        boardId: board!.id,
        principalId: voters[0]!,
        title,
        content: `Our compliance team asks for **${title.toLowerCase()}** before the next renewal.`,
        statusId: open?.id,
        voteCount: voters.length,
        widgetMetadata: { fixture: "team-showcase-v1" },
      })
      .returning({ id: posts.id });
    await db.insert(postVotes).values(
      voters.map((principalId, vote) => ({
        postId: post!.id,
        principalId,
        importance: vote % 2 ? ("important" as const) : ("critical" as const),
      })),
    );
  }
  return {
    segments: rows.length,
    segmentPosts: boardPosts.length,
    betaSegmentId: id("beta-program"),
  };
}
