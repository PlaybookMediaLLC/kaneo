import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import { postTags } from "../../../database/quills/schema/boards";
import { feedbackSignals } from "../../../database/quills/schema/feedback-signals";
import { mergeSuggestions } from "../../../database/quills/schema/merge-suggestions";
import {
  posts,
  postTagAssignments,
  postVotes,
} from "../../../database/quills/schema/posts";
import { postSentiment } from "../../../database/quills/schema/sentiment";
import { addVote } from "../../feedback/votes";
import type { Request } from "./support";
import { duplicatePairs, tagNames } from "./ticket-content";

const MODEL = "local-demo-fixture";
const showcasePost = sql`${posts.widgetMetadata}->>'fixture' = 'portal-showcase-v1'`;
const scores = [
  { scoreReach: 900, scoreImpact: 3, scoreConfidence: 80, scoreEffort: 3 },
  { scoreReach: 400, scoreImpact: 2, scoreConfidence: 100, scoreEffort: 1 },
  { scoreReach: 1200, scoreImpact: 1, scoreConfidence: 50, scoreEffort: 5 },
  { scoreReach: 150, scoreImpact: 0.5, scoreConfidence: 80, scoreEffort: 0.5 },
];

/** Autopilot signals, duplicate suggestions, RICE scores, vote importance, tags and sentiment. */
export async function seedShowcaseTriage(
  db: Database,
  actor: QuillsActor,
  requests: Request[],
) {
  const showcase = await db
    .select({ id: posts.id, title: posts.title })
    .from(posts)
    .where(showcasePost)
    .orderBy(desc(posts.voteCount), posts.id);
  const post = (title: string) => {
    const found = showcase.find((row) => row.title === title);
    if (!found) throw new Error(`Team showcase requires post ${title}`);
    return found.id;
  };

  for (const request of requests) {
    const matched = request.match ? post(request.match) : null;
    const decided = request.status !== "pending";
    await db.insert(feedbackSignals).values({
      conversationId: request.conversationId,
      sourceMessageId: request.sourceMessageId,
      principalId: request.principalId,
      excerpt: request.excerpt,
      suggestedTitle: request.title,
      matchedPostId: matched,
      status: request.status,
      decidedAt: decided ? new Date() : null,
      decidedByPrincipalId: decided ? actor.principalId : null,
      resultingPostId: request.status === "accepted" ? matched : null,
    });
    // An accepted signal is the customer's proxy vote on the matched post.
    if (request.status === "accepted")
      await addVote(db, matched!, [], request.principalId, actor);
  }

  await db.insert(mergeSuggestions).values(
    duplicatePairs.map(([source, target, status], index) => ({
      sourcePostId: post(source),
      targetPostId: post(target),
      status,
      vectorScore: 0.91 - index * 0.04,
      ftsScore: 0.62 - index * 0.05,
      hybridScore: 0.84 - index * 0.04,
      llmConfidence: 0.88 - index * 0.05,
      llmReasoning: `Both requests ask for the same outcome: "${source}" and "${target}".`,
      llmModel: MODEL,
      resolvedAt: status === "dismissed" ? new Date() : null,
      resolvedByPrincipalId: status === "dismissed" ? actor.principalId : null,
    })),
  );

  for (const [index, row] of showcase.slice(0, 12).entries())
    await db
      .update(posts)
      .set(scores[index % scores.length]!)
      .where(eq(posts.id, row.id));

  // About two in three showcase votes say how much the voter needs the request.
  await db
    .update(postVotes)
    .set({
      importance: sql`(array['nice','important','critical'])[1 + abs(hashtext(${postVotes.id}::text)) % 3]`,
    })
    .where(
      sql`${isNull(postVotes.importance)} and abs(hashtext(${postVotes.principalId}::text)) % 3 <> 0 and ${postVotes.postId} in (select ${posts.id} from ${posts} where ${showcasePost})`,
    );

  // A workspace seeded before this stage may already have a tag or a sentiment row.
  await db
    .insert(postTags)
    .values(tagNames.map((name) => ({ name })))
    .onConflictDoNothing();
  const tags = await db
    .select({ id: postTags.id })
    .from(postTags)
    .where(inArray(postTags.name, tagNames));
  await db
    .insert(postTagAssignments)
    .values(
      showcase
        .filter((_, index) => index % 2 === 0)
        .map((row, index) => ({
          postId: row.id,
          tagId: tags[index % tags.length]!.id,
        })),
    )
    .onConflictDoNothing();
  const moods = ["positive", "neutral", "negative", "positive"] as const;
  await db
    .insert(postSentiment)
    .values(
      showcase.map((row, index) => ({
        postId: row.id,
        sentiment: moods[index % moods.length]!,
        confidence: 0.8,
        model: MODEL,
      })),
    )
    .onConflictDoNothing();
  return {
    signals: requests.length,
    mergeSuggestions: duplicatePairs.length,
    tags: tags.length,
  };
}
