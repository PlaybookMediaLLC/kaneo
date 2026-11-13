import { createId } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import { principal, user } from "../../../database/quills/schema/auth";
import {
  boards,
  roadmapColumns,
  roadmaps,
} from "../../../database/quills/schema/boards";
import {
  postComments,
  postCommentReactions,
  posts,
  postVotes,
} from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { feedbackGroups, firstNames, lastNames, replies } from "./content";

export async function seedShowcaseFeedback(db: Database, actor: QuillsActor) {
  const now = Date.now();
  const people = lastNames.flatMap((last) =>
    firstNames.map((first) => ({
      id: createId("user"),
      name: `${first} ${last}`,
      updatedAt: new Date(now),
    })),
  );
  await db.insert(user).values(people);
  const authors = people.map((person) => ({
    id: createId("principal"),
    userId: person.id,
    displayName: person.name,
    type: "user",
    role: "user",
    createdAt: new Date(now - 240 * 86400000),
  }));
  await db.insert(principal).values(authors);
  const statuses = await db.select().from(postStatuses);
  const statusSlugs = [
    "planned",
    "in_progress",
    "complete",
    "under_review",
    "open",
    "closed",
  ];
  const statusIds = statusSlugs.map((slug) => {
    const status = statuses.find((row) => row.slug === slug && !row.deletedAt);
    if (!status) throw new Error(`Portal showcase requires status ${slug}`);
    return status.id;
  });
  const voteRows: (typeof postVotes.$inferInsert)[] = [];
  const commentRows: (typeof postComments.$inferInsert)[] = [];
  const reactionRows: (typeof postCommentReactions.$inferInsert)[] = [];
  let index = 0;
  let featuredPostId = "";
  for (const group of feedbackGroups) {
    let [board] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.slug, group.slug));
    if (!board)
      [board] = await db
        .insert(boards)
        .values({
          name: group.name,
          slug: group.slug,
          description: group.description,
        })
        .returning({ id: boards.id });
    for (const title of group.titles) {
      const postId = createId("post");
      if (index === 0) featuredPostId = postId;
      const voteCount = index === 0 ? 144 : 4 + (((119 - index) * 13) % 117);
      const commentCount = index === 0 ? 128 : 3 + (index % 8);
      const createdAt = new Date(now - (180 - index) * 86400000);
      const statusId = statusIds[index % 6]!;
      await db.insert(posts).values({
        id: postId,
        boardId: board!.id,
        principalId: authors[index % authors.length]!.id,
        title,
        statusId,
        voteCount,
        commentCount,
        createdAt,
        updatedAt: new Date(now - (index % 14) * 86400000),
        eta: new Date(
          Date.UTC(
            new Date(now).getUTCFullYear(),
            new Date(now).getUTCMonth() + (index % 4),
            15,
          ),
        ),
        widgetMetadata: { fixture: "portal-showcase-v1" },
        content:
          index === 0
            ? "Connect customer feedback to the work our team is already tracking in Linear. We would love to create an issue from a request and keep its status in sync.\n\n## Our workflow\n\n1. Collect feedback from customers in one place.\n2. Link a request to an existing issue or create a new one.\n3. Keep customers informed when the work moves forward.\n\n**The important detail:** keep the original conversation and vote history, even when several requests lead to the same issue.\n\nWhat would make this useful for your team? Share your workflow below."
            : `We would love to see **${title.toLowerCase()}** in Quills.\n\n${replies[index % replies.length]}\n\n### What would help\n\n- Keep the workflow clear for new teammates.\n- Preserve the current context and existing history.\n- Make the same action comfortable on a phone and a desktop.\n\nHow are other teams handling this today?`,
      });
      for (let vote = 0; vote < voteCount; vote++)
        voteRows.push({
          postId,
          principalId: authors[(index + vote) % authors.length]!.id,
          createdAt,
        });
      let rootId = createId("post_comment");
      for (let comment = 0; comment < commentCount; comment++) {
        const id = createId("post_comment");
        const isReply = comment % 4 === 1;
        if (!isReply) rootId = id;
        const team = comment === 1;
        commentRows.push({
          id,
          postId,
          parentId: isReply ? rootId : null,
          principalId: team
            ? actor.principalId
            : authors[(index * 3 + comment) % authors.length]!.id,
          isTeamMember: team,
          content: team
            ? "Thanks for sharing the details. We are collecting examples from teams with different workflows. Please keep adding your use cases here; we will post the next update in this thread."
            : `${replies[(index + comment) % replies.length]}${isReply ? " Thanks for raising this — that matches our experience too." : ""}`,
          createdAt: new Date(
            createdAt.getTime() + (comment + 1) * 6 * 3600000,
          ),
        });
        for (let reaction = 0; reaction < comment % 5; reaction++)
          reactionRows.push({
            commentId: id,
            principalId:
              authors[(index + comment + reaction) % authors.length]!.id,
            emoji: "👍",
          });
      }
      index++;
    }
  }
  for (let offset = 0; offset < voteRows.length; offset += 1000)
    await db.insert(postVotes).values(voteRows.slice(offset, offset + 1000));
  await db.insert(postComments).values(commentRows);
  await db.insert(postCommentReactions).values(reactionRows);
  const [roadmap] = await db
    .insert(roadmaps)
    .values({
      name: "Product roadmap",
      slug: "showcase-roadmap",
      position: -1,
      description:
        "What we are planning, building, and have shipped. Explore a card to join the conversation.",
    })
    .returning({ id: roadmaps.id });
  await db.insert(roadmapColumns).values(
    statusIds.slice(0, 3).map((id, position) => {
      const status = statuses.find((row) => row.id === id)!;
      return {
        roadmapId: roadmap!.id,
        statusId: id,
        name: status.name,
        color: status.color,
        position,
      };
    }),
  );
  await db.insert(roadmaps).values({
    name: "Release calendar",
    slug: "showcase-timeline",
    position: 0,
    type: "date",
    dateSource: "eta",
    frequency: "monthly",
    description:
      "Explore upcoming work by target month. Dates in this local demo are illustrative.",
    baseFilter: { statusIds: statusIds.slice(0, 2) },
  });
  return {
    posts: index,
    comments: commentRows.length,
    votes: voteRows.length,
    authors: authors.length,
    featuredPostId,
  };
}
