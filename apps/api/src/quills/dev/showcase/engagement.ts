import { isNotNull } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import {
  changelogReactions,
  changelogReads,
} from "../../../database/quills/schema/changelog-engagement";
import { FEEDBACK_REACTION_EMOJIS } from "../../../database/quills/schema/posts";
import {
  surveyResponses,
  surveys,
} from "../../../database/quills/schema/surveys";
import { PMF_OPTIONS } from "../../feedback/surveys-rules";

type PrincipalId = QuillsActor["principalId"];
type Survey = Pick<
  typeof surveys.$inferInsert,
  "type" | "question" | "status" | "options" | "targetSegmentIds"
> & { responses: number; score?: number[] };

const DAY = 86_400_000;
const comments = ["Clear and quick.", "", "Very helpful team.", ""];

/** Surveys with responses, and reactions and reads on the published changelog entries. */
export async function seedShowcaseEngagement(
  db: Database,
  actor: QuillsActor,
  customers: PrincipalId[],
  betaSegmentId: string,
) {
  const scripts: Survey[] = [
    {
      type: "nps",
      question: "How likely are you to recommend Quills to a colleague?",
      status: "active",
      responses: 32,
      score: [10, 9, 8, 7, 9, 10, 6, 3],
    },
    {
      type: "csat",
      question: "How satisfied are you with our support this month?",
      status: "closed",
      responses: 18,
      score: [5, 4, 5, 3, 2],
    },
    {
      type: "poll",
      question: "Which area should we improve next?",
      status: "active",
      responses: 24,
      options: ["Roadmaps", "Integrations", "Mobile", "Help center"],
      targetSegmentIds: [betaSegmentId],
    },
    {
      type: "pmf",
      question: "How would you feel if you could no longer use Quills?",
      status: "draft",
      responses: 0,
      options: PMF_OPTIONS,
    },
  ];
  for (const { responses, score, ...script } of scripts) {
    const [survey] = await db
      .insert(surveys)
      .values({
        ...script,
        createdByPrincipalId: actor.principalId,
        createdAt: new Date(Date.now() - 30 * DAY),
      })
      .returning({ id: surveys.id });
    const options = script.options ?? [];
    if (responses)
      await db.insert(surveyResponses).values(
        customers.slice(0, responses).map((principalId, n) => ({
          surveyId: survey!.id,
          principalId,
          score: score ? score[n % score.length] : null,
          choice: options.length ? options[n % options.length] : null,
          comment: comments[n % comments.length] || null,
          createdAt: new Date(Date.now() - (n % 28) * DAY),
        })),
      );
  }

  const entries = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(isNotNull(changelogEntries.publishedAt));
  await db
    .insert(changelogReactions)
    .values(
      entries.flatMap((entry, index) =>
        customers.slice(0, 6 + index * 2).map((principalId, n) => ({
          changelogEntryId: entry.id,
          principalId,
          emoji:
            FEEDBACK_REACTION_EMOJIS[
              (index + n) % FEEDBACK_REACTION_EMOJIS.length
            ]!,
        })),
      ),
    )
    .onConflictDoNothing();
  // A reader's mark counts as a read of every entry published before it.
  await db
    .insert(changelogReads)
    .values(
      customers.slice(0, 60).map((principalId, n) => ({
        principalId,
        lastReadAt: new Date(Date.now() - n * DAY),
      })),
    )
    .onConflictDoNothing();
  return {
    surveys: scripts.length,
    surveyResponses: scripts.reduce((sum, row) => sum + row.responses, 0),
  };
}
