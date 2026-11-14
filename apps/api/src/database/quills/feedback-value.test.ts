import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../schema";
import { repoint } from "../../quills/directory/lead-merge";
import { harness } from "../../quills/jobs/handlers/harness.fixture";
import { WIPED_TABLES } from "../../quills/jobs/handlers/wipe";
import { pruneQuillsWorkspace } from "../../quills/jobs/retention";
import { OMITTED_TABLES, portableTables } from "../../quills/transfer/archive";
import type { Database } from "./client";
import { principal } from "./schema/auth";
import { boards } from "./schema/boards";
import { changelogEntries } from "./schema/changelog";
import {
  changelogReactions,
  changelogReads,
} from "./schema/changelog-engagement";
import { contentTranslations } from "./schema/content-translations";
import { conversationMessages, conversations } from "./schema/conversation";
import { feedbackSignals } from "./schema/feedback-signals";
import { postComments, postVotes, posts } from "./schema/posts";
import { surveyResponses, surveys } from "./schema/surveys";
import { ticketStatuses, tickets } from "./schema/tickets";

// RFC 0003 seams: the new tables and columns under the restricted runtime role (quills_runtime).

let pool: Pool;
vi.mock("../index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("fvseams");
const NEW_TABLES = [
  "feedback_signals",
  "surveys",
  "survey_responses",
  "changelog_reactions",
  "changelog_reads",
  "content_translations",
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Parent rows in one workspace, and a customer (with a second one) to act for. */
async function seed(db: Database) {
  const [customer, other] = await db
    .insert(principal)
    .values([
      { type: "anonymous", role: "user", createdAt: new Date() },
      { type: "anonymous", role: "user", createdAt: new Date() },
    ])
    .returning({ id: principal.id });
  const [board] = await db
    .insert(boards)
    .values({ name: "Board", slug: "board" })
    .returning({ id: boards.id });
  const [post] = await db
    .insert(posts)
    .values({
      boardId: board!.id,
      title: "Dark mode",
      content: "Please",
      principalId: customer!.id,
    })
    .returning({ id: posts.id });
  const [comment] = await db
    .insert(postComments)
    .values({ postId: post!.id, principalId: customer!.id, content: "Yes" })
    .returning({ id: postComments.id });
  const [conversation] = await db
    .insert(conversations)
    .values({ visitorPrincipalId: customer!.id, channel: "messenger" })
    .returning({ id: conversations.id });
  const [message, otherMessage] = await db
    .insert(conversationMessages)
    .values(
      ["Please add dark mode", "And an export"].map((content) => ({
        conversationId: conversation!.id,
        principalId: customer!.id,
        senderType: "visitor" as const,
        content,
      })),
    )
    .returning({ id: conversationMessages.id });
  const [status] = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.isDefault, true));
  const [ticket] = await db
    .insert(tickets)
    .values({ title: "Ticket", statusId: status!.id })
    .returning({ id: tickets.id });
  const [entry] = await db
    .insert(changelogEntries)
    .values({ title: "Shipped", content: "Dark mode" })
    .returning({ id: changelogEntries.id });
  const [survey] = await db
    .insert(surveys)
    .values({ type: "nps", question: "How likely are you to recommend us?" })
    .returning({ id: surveys.id });
  return {
    customer: customer!.id,
    other: other!.id,
    board: board!.id,
    post: post!.id,
    comment: comment!.id,
    conversation: conversation!.id,
    message: message!.id,
    otherMessage: otherMessage!.id,
    ticket: ticket!.id,
    entry: entry!.id,
    survey: survey!.id,
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;
let fa: Seed, fb: Seed;

/** One row in each new table. */
async function fill(db: Database, f: Seed) {
  await db.insert(feedbackSignals).values({
    conversationId: f.conversation,
    sourceMessageId: f.message,
    principalId: f.customer,
    excerpt: "Please add dark mode",
    suggestedTitle: "Dark mode",
    matchedPostId: f.post,
  });
  await db
    .insert(surveyResponses)
    .values({ surveyId: f.survey, principalId: f.customer, score: 9 });
  await db.insert(changelogReactions).values({
    changelogEntryId: f.entry,
    principalId: f.customer,
    emoji: "🚀",
  });
  await db.insert(changelogReads).values({ principalId: f.customer });
  await db.insert(contentTranslations).values({
    postId: f.post,
    locale: "fr",
    title: "Mode sombre",
    content: "S'il vous plaît",
    sourceHash: hash("Dark mode"),
  });
}

/** The new tables' rows that the workspace can read, by table. */
const visible = (workspaceId: string, userId: string) =>
  h.as(workspaceId, userId, async (db) => {
    const rows: Record<string, { workspaceId: string }[]> = {
      feedback_signals: await db.select().from(feedbackSignals),
      surveys: await db.select().from(surveys),
      survey_responses: await db.select().from(surveyResponses),
      changelog_reactions: await db.select().from(changelogReactions),
      changelog_reads: await db.select().from(changelogReads),
      content_translations: await db.select().from(contentTranslations),
    };
    return rows;
  });

/** Runs one statement in workspace A as the owner. */
const inA = <T>(work: (db: Database) => Promise<T>) => h.as(h.a, h.owner, work);

describe.skipIf(!url)("RFC 0003 schema seams", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    await h.start(pool, url!);
    fa = await h.as(h.a, h.owner, seed);
    fb = await h.as(h.b, h.outsider, seed);
    await h.as(h.a, h.owner, (db) => fill(db, fa));
    await h.as(h.b, h.outsider, (db) => fill(db, fb));
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("shows each workspace only its own rows", async () => {
    for (const [workspaceId, userId] of [
      [h.a, h.owner],
      [h.b, h.outsider],
    ] as const) {
      const rows = await visible(workspaceId, userId);
      for (const table of NEW_TABLES) {
        expect(rows[table], table).toHaveLength(1);
        expect(rows[table]![0]!.workspaceId, table).toBe(workspaceId);
      }
    }
    // Both rows exist; only the policy hides the other workspace's row.
    for (const table of NEW_TABLES) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM quills.${table} WHERE workspace_id = ANY($1)`,
        [[h.a, h.b]],
      );
      expect(rows[0].n, table).toBe(2);
    }
  });

  it("rejects rows for another workspace and links to its parents", async () => {
    const foreignRows: [string, (db: Database) => Promise<unknown>][] = [
      [
        "feedback_signals",
        (db) =>
          db.insert(feedbackSignals).values({
            workspaceId: h.b,
            ticketId: fb.ticket,
            sourceMessageId: fb.otherMessage,
            principalId: fb.other,
            excerpt: "x",
            suggestedTitle: "x",
          }),
      ],
      [
        "surveys",
        (db) =>
          db
            .insert(surveys)
            .values({ workspaceId: h.b, type: "poll", question: "x" }),
      ],
      [
        "survey_responses",
        (db) =>
          db.insert(surveyResponses).values({
            workspaceId: h.b,
            surveyId: fb.survey,
            principalId: fb.other,
          }),
      ],
      [
        "changelog_reactions",
        (db) =>
          db.insert(changelogReactions).values({
            workspaceId: h.b,
            changelogEntryId: fb.entry,
            principalId: fb.other,
            emoji: "👍",
          }),
      ],
      [
        "changelog_reads",
        (db) =>
          db
            .insert(changelogReads)
            .values({ workspaceId: h.b, principalId: fb.other }),
      ],
      [
        "content_translations",
        (db) =>
          db.insert(contentTranslations).values({
            workspaceId: h.b,
            commentId: fb.comment,
            locale: "de",
            content: "x",
            sourceHash: hash("Yes"),
          }),
      ],
    ];
    for (const [table, work] of foreignRows)
      await expect(inA(work), table).rejects.toMatchObject({
        cause: { code: "42501" },
      });

    const foreignParents: [string, (db: Database) => Promise<unknown>][] = [
      [
        "feedback_signals_source_message_fk",
        (db) =>
          db.insert(feedbackSignals).values({
            conversationId: fa.conversation,
            sourceMessageId: fb.otherMessage,
            principalId: fa.other,
            excerpt: "x",
            suggestedTitle: "x",
          }),
      ],
      [
        "feedback_signals_ticket_fk",
        (db) =>
          db.insert(feedbackSignals).values({
            ticketId: fb.ticket,
            sourceMessageId: fa.otherMessage,
            principalId: fa.other,
            excerpt: "x",
            suggestedTitle: "x",
          }),
      ],
      [
        "survey_responses_survey_fk",
        (db) =>
          db
            .insert(surveyResponses)
            .values({ surveyId: fb.survey, principalId: fa.other }),
      ],
      [
        "changelog_reactions_entry_fk",
        (db) =>
          db.insert(changelogReactions).values({
            changelogEntryId: fb.entry,
            principalId: fa.other,
            emoji: "👍",
          }),
      ],
      [
        "changelog_reads_principal_fk",
        (db) => db.insert(changelogReads).values({ principalId: fb.other }),
      ],
      [
        "content_translations_post_fk",
        (db) =>
          db.insert(contentTranslations).values({
            postId: fb.post,
            locale: "de",
            content: "x",
            sourceHash: hash("x"),
          }),
      ],
    ];
    for (const [constraint, work] of foreignParents)
      await expect(inA(work), constraint).rejects.toMatchObject({
        cause: { code: "23503", constraint },
      });

    // Another workspace's rows cannot be changed or removed.
    await inA(async (db) => {
      expect(
        await db
          .update(surveys)
          .set({ question: "Changed" })
          .where(eq(surveys.id, fb.survey))
          .returning(),
      ).toEqual([]);
      expect(
        await db
          .delete(changelogReads)
          .where(eq(changelogReads.principalId, fb.customer))
          .returning(),
      ).toEqual([]);
      expect(
        await db
          .update(feedbackSignals)
          .set({ status: "dismissed", decidedAt: new Date() })
          .where(eq(feedbackSignals.sourceMessageId, fb.message))
          .returning(),
      ).toEqual([]);
    });
    const rows = await visible(h.b, h.outsider);
    expect(rows.changelog_reads).toHaveLength(1);
    expect(
      await h.as(h.b, h.outsider, (db) =>
        db
          .select({ question: surveys.question, status: surveys.status })
          .from(surveys),
      ),
    ).toEqual([
      { question: "How likely are you to recommend us?", status: "draft" },
    ]);
  });

  it("keeps the unique keys", async () => {
    const duplicates: [string, (db: Database) => Promise<unknown>][] = [
      // The source message is the key: the same message from its ticket is still a duplicate.
      [
        "feedback_signals_source_message_idx",
        (db) =>
          db.insert(feedbackSignals).values({
            ticketId: fa.ticket,
            sourceMessageId: fa.message,
            principalId: fa.customer,
            excerpt: "Dark mode again",
            suggestedTitle: "Dark mode",
          }),
      ],
      [
        "survey_responses_survey_principal_idx",
        (db) =>
          db.insert(surveyResponses).values({
            surveyId: fa.survey,
            principalId: fa.customer,
            score: 3,
          }),
      ],
      [
        "changelog_reactions_pk",
        (db) =>
          db.insert(changelogReactions).values({
            changelogEntryId: fa.entry,
            principalId: fa.customer,
            emoji: "🚀",
          }),
      ],
      [
        "changelog_reads_workspace_id_principal_id_pk",
        (db) => db.insert(changelogReads).values({ principalId: fa.customer }),
      ],
      [
        "content_translations_post_idx",
        (db) =>
          db.insert(contentTranslations).values({
            postId: fa.post,
            locale: "fr",
            content: "Encore",
            sourceHash: hash("Dark mode"),
          }),
      ],
    ];
    for (const [constraint, work] of duplicates)
      await expect(inA(work), constraint).rejects.toMatchObject({
        cause: { code: "23505", constraint },
      });
    // Another emoji, a new source text or another locale is a new row.
    await inA(async (db) => {
      await db.insert(changelogReactions).values({
        changelogEntryId: fa.entry,
        principalId: fa.customer,
        emoji: "🎉",
      });
      await db.insert(contentTranslations).values([
        {
          postId: fa.post,
          locale: "fr",
          content: "Modifié",
          sourceHash: hash("Dark mode, edited"),
        },
        {
          postId: fa.post,
          locale: "de",
          content: "Bitte",
          sourceHash: hash("Dark mode"),
        },
        {
          commentId: fa.comment,
          locale: "fr",
          content: "Oui",
          sourceHash: hash("Yes"),
        },
      ]);
    });
    await expect(
      inA((db) =>
        db.insert(contentTranslations).values({
          commentId: fa.comment,
          locale: "fr",
          content: "Oui",
          sourceHash: hash("Yes"),
        }),
      ),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "content_translations_comment_idx" },
    });
  });

  it("rejects values outside each check", async () => {
    const vote = await inA(async (db) => {
      const [row] = await db
        .insert(postVotes)
        .values({
          postId: fa.post,
          principalId: fa.other,
          importance: "critical",
        })
        .returning({ id: postVotes.id, importance: postVotes.importance });
      return row!;
    });
    expect(vote.importance).toBe("critical");
    const setPost =
      (values: Partial<typeof posts.$inferInsert>) => (db: Database) =>
        db.update(posts).set(values).where(eq(posts.id, fa.post));
    const signal =
      (values: Partial<typeof feedbackSignals.$inferInsert>) =>
      (db: Database) =>
        db.insert(feedbackSignals).values({
          conversationId: fa.conversation,
          sourceMessageId: fa.otherMessage,
          principalId: fa.customer,
          excerpt: "Export",
          suggestedTitle: "Export",
          ...values,
        });
    const response =
      (values: Partial<typeof surveyResponses.$inferInsert>) =>
      (db: Database) =>
        db
          .insert(surveyResponses)
          .values({ surveyId: fa.survey, principalId: fa.other, ...values });
    const translation =
      (values: Partial<typeof contentTranslations.$inferInsert>) =>
      (db: Database) =>
        db.insert(contentTranslations).values({
          postId: fa.post,
          locale: "es",
          content: "Por favor",
          sourceHash: hash("Dark mode"),
          ...values,
        });
    const survey =
      (values: Partial<typeof surveys.$inferInsert>) => (db: Database) =>
        db
          .insert(surveys)
          .values({ type: "poll", question: "Which?", ...values });
    const cases: [string, (db: Database) => Promise<unknown>][] = [
      [
        "post_votes_importance_check",
        (db) =>
          db
            .update(postVotes)
            .set({ importance: "urgent" as never })
            .where(eq(postVotes.id, vote.id)),
      ],
      ["posts_score_reach_check", setPost({ scoreReach: -1 })],
      ["posts_score_impact_check", setPost({ scoreImpact: 0.3 })],
      ["posts_score_impact_check", setPost({ scoreImpact: 4 })],
      ["posts_score_confidence_check", setPost({ scoreConfidence: 101 })],
      ["posts_score_confidence_check", setPost({ scoreConfidence: -1 })],
      ["posts_score_effort_check", setPost({ scoreEffort: 0 })],
      ["posts_score_effort_check", setPost({ scoreEffort: Number.NaN })],
      [
        "posts_score_effort_check",
        setPost({ scoreEffort: Number.POSITIVE_INFINITY }),
      ],
      [
        "boards_visible_segment_ids_array_check",
        (db) =>
          db
            .update(boards)
            .set({ visibleSegmentIds: sql`'{"segment":1}'::jsonb` })
            .where(eq(boards.id, fa.board)),
      ],
      ["survey_responses_score_check", response({ score: 11 })],
      ["survey_responses_score_check", response({ score: -1 })],
      ["survey_responses_choice_check", response({ choice: "" })],
      [
        "survey_responses_comment_check",
        response({ comment: "x".repeat(2001) }),
      ],
      ["surveys_type_check", survey({ type: "quiz" as never })],
      ["surveys_status_check", survey({ status: "paused" as never })],
      ["surveys_question_check", survey({ question: "" })],
      [
        "surveys_options_check",
        survey({ options: sql`'{"a":1}'::jsonb` as never }),
      ],
      [
        "surveys_options_check",
        survey({
          options: Array.from({ length: 21 }, (_, i) => `Option ${i}`),
        }),
      ],
      [
        "surveys_target_segment_ids_array_check",
        survey({ targetSegmentIds: sql`'"segment"'::jsonb` as never }),
      ],
      [
        "changelog_reactions_emoji_check",
        (db) =>
          db.insert(changelogReactions).values({
            changelogEntryId: fa.entry,
            principalId: fa.other,
            emoji: "🔥" as never,
          }),
      ],
      ["feedback_signals_source_check", signal({ conversationId: null })],
      ["feedback_signals_source_check", signal({ ticketId: fa.ticket })],
      [
        "feedback_signals_status_check",
        signal({ status: "merged" as never, decidedAt: new Date() }),
      ],
      ["feedback_signals_decided_check", signal({ status: "accepted" })],
      ["feedback_signals_decided_check", signal({ decidedAt: new Date() })],
      ["feedback_signals_excerpt_check", signal({ excerpt: "x".repeat(2001) })],
      [
        "feedback_signals_suggested_title_check",
        signal({ suggestedTitle: "" }),
      ],
      [
        "content_translations_entity_check",
        translation({ commentId: fa.comment }),
      ],
      ["content_translations_entity_check", translation({ postId: null })],
      [
        "content_translations_title_check",
        translation({ title: "x".repeat(401) }),
      ],
      ["content_translations_locale_check", translation({ locale: "x" })],
      [
        "content_translations_content_check",
        translation({ content: "x".repeat(20001) }),
      ],
      [
        "content_translations_source_hash_check",
        translation({ sourceHash: "abc" }),
      ],
    ];
    for (const [constraint, work] of cases)
      await expect(inA(work), constraint).rejects.toMatchObject({
        cause: { code: "23514", constraint },
      });
    // The bounds themselves are allowed.
    await inA(async (db) => {
      await setPost({
        scoreReach: 0,
        scoreImpact: 0.25,
        scoreConfidence: 100,
        scoreEffort: 0.5,
      })(db);
      await setPost({ scoreImpact: 3, scoreConfidence: 0 })(db);
      await db
        .update(boards)
        .set({ visibleSegmentIds: [] })
        .where(eq(boards.id, fa.board));
      await response({ score: 0, choice: "Yes", comment: "" })(db);
      await db
        .update(surveyResponses)
        .set({ score: 10 })
        .where(eq(surveyResponses.principalId, fa.other));
      await signal({ status: "dismissed", decidedAt: new Date() })(db);
    });
  });

  it("makes every new foreign key deferrable for workspace imports", async () => {
    const { rows } = await pool.query<{
      name: string;
      deferrable: boolean;
      deferred: boolean;
    }>(
      `SELECT c.conname AS name, c.condeferrable AS deferrable, c.condeferred AS deferred
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relnamespace = 'quills'::regnamespace AND c.contype = 'f' AND t.relname = ANY($1)`,
      [NEW_TABLES],
    );
    expect(rows).toHaveLength(21);
    for (const row of rows)
      expect(row, row.name).toMatchObject({
        deferrable: true,
        deferred: false,
      });
  });

  it("removes translations with their post and keeps the signal", async () => {
    await inA(async (db) => {
      const [post] = await db
        .insert(posts)
        .values({
          boardId: fa.board,
          title: "Export",
          content: "CSV",
          principalId: fa.customer,
        })
        .returning({ id: posts.id });
      await db.insert(contentTranslations).values({
        postId: post!.id,
        locale: "fr",
        content: "CSV",
        sourceHash: hash("Export"),
      });
      await db
        .update(feedbackSignals)
        .set({ matchedPostId: post!.id })
        .where(eq(feedbackSignals.sourceMessageId, fa.message));
      await db.delete(posts).where(eq(posts.id, post!.id));
      expect(
        await db
          .select()
          .from(contentTranslations)
          .where(eq(contentTranslations.postId, post!.id)),
      ).toEqual([]);
      const [kept] = await db
        .select({ matchedPostId: feedbackSignals.matchedPostId })
        .from(feedbackSignals)
        .where(eq(feedbackSignals.sourceMessageId, fa.message));
      expect(kept).toEqual({ matchedPostId: null });
    });
  });

  it("removes cached translations after the log retention", async () => {
    const ids = await inA(async (db) =>
      db
        .insert(contentTranslations)
        .values(
          [91, 89].map((days) => ({
            postId: fa.post,
            locale: `it-${days}`,
            content: "Per favore",
            sourceHash: hash("Dark mode"),
            createdAt: new Date(Date.now() - days * 86400000),
          })),
        )
        .returning({ locale: contentTranslations.locale }),
    );
    expect(ids).toHaveLength(2);
    await h.system(h.a, (db) => pruneQuillsWorkspace(db));
    const left = await inA((db) =>
      db
        .select({ locale: contentTranslations.locale })
        .from(contentTranslations)
        .where(sql`${contentTranslations.locale} LIKE 'it-%'`),
    );
    expect(left).toEqual([{ locale: "it-89" }]);
  });

  it("moves a lead's rows to the customer in a lead merge", async () => {
    await inA(async (db) => {
      const [lead] = await db
        .insert(principal)
        .values({ type: "anonymous", role: "user", createdAt: new Date() })
        .returning({ id: principal.id });
      const [message] = await db
        .insert(conversationMessages)
        .values({
          conversationId: fa.conversation,
          principalId: fa.customer,
          senderType: "visitor",
          content: "Slack alerts",
        })
        .returning({ id: conversationMessages.id });
      await db.insert(feedbackSignals).values({
        conversationId: fa.conversation,
        sourceMessageId: message!.id,
        principalId: lead!.id,
        excerpt: "Slack alerts",
        suggestedTitle: "Slack alerts",
      });
      await db
        .insert(surveyResponses)
        .values({ surveyId: fa.survey, principalId: lead!.id, score: 1 });
      await db.insert(changelogReactions).values(
        (["🚀", "👀"] as const).map((emoji) => ({
          changelogEntryId: fa.entry,
          principalId: lead!.id,
          emoji,
        })),
      );
      await db.insert(changelogReads).values({ principalId: lead!.id });

      await repoint(db, lead!.id, fa.customer);

      // The customer's own rows win where the keys collide.
      expect(
        await db
          .select({
            principalId: surveyResponses.principalId,
            score: surveyResponses.score,
          })
          .from(surveyResponses)
          .where(eq(surveyResponses.surveyId, fa.survey)),
      ).toEqual(
        expect.arrayContaining([{ principalId: fa.customer, score: 9 }]),
      );
      const reactions = await db
        .select({ emoji: changelogReactions.emoji })
        .from(changelogReactions)
        .where(eq(changelogReactions.principalId, fa.customer));
      expect(reactions.map((row) => row.emoji).sort()).toEqual(
        ["🎉", "🚀", "👀"].sort(),
      );
      for (const table of [
        feedbackSignals,
        surveyResponses,
        changelogReactions,
        changelogReads,
      ])
        expect(
          await db.select().from(table).where(eq(table.principalId, lead!.id)),
        ).toEqual([]);
      const [moved] = await db
        .select({ principalId: feedbackSignals.principalId })
        .from(feedbackSignals)
        .where(eq(feedbackSignals.sourceMessageId, message!.id));
      expect(moved).toEqual({ principalId: fa.customer });
      expect(
        await db
          .select()
          .from(changelogReads)
          .where(eq(changelogReads.principalId, fa.customer)),
      ).toHaveLength(1);
    });
  });
});

describe("RFC 0003 table lifecycle", () => {
  it("transfers every new table except the translation cache", () => {
    const portable = portableTables.map(({ config }) => config.name);
    for (const table of NEW_TABLES.filter(
      (name) => name !== "content_translations",
    ))
      expect(portable, table).toContain(table);
    expect(OMITTED_TABLES).toContain("content_translations");
    expect(portable).not.toContain("content_translations");
  });

  it("wipes every new table", () => {
    for (const table of NEW_TABLES)
      expect(WIPED_TABLES, table).toContain(table);
  });
});
