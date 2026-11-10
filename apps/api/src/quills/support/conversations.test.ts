import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toUuid } from "@kaneo/ids";
import { boards } from "../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../database/quills/schema/conversation-attributes";
import { events } from "../../database/quills/schema/events";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { postComments, posts } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import { teams } from "../../database/quills/schema/teams";
import * as kaneo from "../../database/schema";
import { startFeature } from "../feedback/harness.fixture";
import { conversation, customer } from "./seed.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
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
let world: Awaited<ReturnType<typeof startFeature>>;
let made = 0;
const unique = (label: string) =>
  `${label}-${Date.now().toString(36)}-${++made}`;

type Ids = Awaited<ReturnType<typeof seedA>>;
let ids: Ids;
let foreign: Awaited<ReturnType<typeof seedB>>;

async function seedA() {
  const { a, users } = world;
  // The member's actor exists before any request.
  const memberId = await world.scoped(
    a,
    users.member,
    async (_db, actor) => actor.principalId,
  );
  // A former member: the actor stays after the membership ends.
  await world.db.insert(kaneo.workspaceUserTable).values({
    workspaceId: a,
    userId: users.outsider,
    role: "member",
    joinedAt: new Date(),
  });
  const formerId = await world.scoped(
    a,
    users.outsider,
    async (_db, actor) => actor.principalId,
  );
  await world.db
    .delete(kaneo.workspaceUserTable)
    .where(
      and(
        eq(kaneo.workspaceUserTable.workspaceId, a),
        eq(kaneo.workspaceUserTable.userId, users.outsider),
      ),
    );
  return world.scoped(a, users.owner, async (db, actor) => {
    const visitor = await customer(db, `${unique("visitor")}@example.test`);
    const other = await customer(db, `${unique("other")}@example.test`);
    const tester = await customer(
      db,
      `${unique("tester")}@example.test`,
      actor.principalId,
    );
    const open = await conversation(db, actor.principalId, visitor);
    const mine = await conversation(db, actor.principalId, visitor, {
      assignedAgentPrincipalId: actor.principalId,
    });
    const test = await conversation(db, actor.principalId, tester, {
      assignedAgentPrincipalId: actor.principalId,
    });
    const spam = await conversation(db, actor.principalId, visitor, {
      status: "closed",
      endReason: "spam",
    });
    const [tag] = await db
      .insert(conversationTags)
      .values({ name: unique("tag") })
      .returning({ id: conversationTags.id });
    await db.insert(conversationTagAssignments).values([
      { conversationId: open.conversationId, conversationTagId: tag!.id },
      { conversationId: test.conversationId, conversationTagId: tag!.id },
    ]);
    const [board, hiddenBoard] = await db
      .insert(boards)
      .values([
        { name: "Open", slug: unique("open") },
        { name: "Hidden", slug: unique("hidden") },
      ])
      .returning({ id: boards.id });
    await db
      .insert(boardProjects)
      .values({ boardId: hiddenBoard!.id, projectId: world.projects.hidden });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.isDefault, true));
    const [hiddenPost, openPost] = await db
      .insert(posts)
      .values([
        {
          title: "Hidden",
          content: "Hidden",
          boardId: hiddenBoard!.id,
          principalId: actor.principalId,
          statusId: status!.id,
        },
        {
          title: "Open",
          content: "Open",
          boardId: board!.id,
          principalId: actor.principalId,
          statusId: status!.id,
        },
      ])
      .returning({ id: posts.id });
    return {
      ownerId: actor.principalId,
      memberId,
      formerId,
      visitor,
      other,
      open,
      mine,
      test,
      spam,
      tagId: tag!.id,
      boardId: board!.id,
      hiddenBoardId: hiddenBoard!.id,
      hiddenPostId: hiddenPost!.id,
      openPostId: openPost!.id,
    };
  });
}

async function seedB() {
  const { b, users } = world;
  return world.scoped(b, users.outsider, async (db, actor) => {
    const email = `${unique("foreign")}@example.test`;
    const visitor = await customer(db, email);
    const thread = await conversation(db, actor.principalId, visitor);
    const [tag] = await db
      .insert(conversationTags)
      .values({ name: unique("tag") })
      .returning({ id: conversationTags.id });
    const [team] = await db
      .insert(teams)
      .values({ name: unique("team") })
      .returning({ id: teams.id });
    const [board] = await db
      .insert(boards)
      .values({ name: "Foreign", slug: unique("foreign") })
      .returning({ id: boards.id });
    const [post] = await db
      .insert(posts)
      .values({
        title: "Foreign",
        content: "Foreign",
        boardId: board!.id,
        principalId: actor.principalId,
      })
      .returning({ id: posts.id });
    return {
      ...thread,
      visitor,
      email,
      teammateId: actor.principalId,
      tagId: tag!.id,
      teamId: team!.id,
      postId: post!.id,
    };
  });
}

const owner = (method: string, path: string, body?: unknown) =>
  world.request(world.users.owner, method, path, body);
const member = (method: string, path: string, body?: unknown) =>
  world.request(world.users.member, method, path, body);
const row = (id: string) =>
  world.scoped(world.a, world.users.owner, async (db) => {
    const [found] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id as never));
    return found;
  });
const eventCount = (type: string, entityId?: string) =>
  world.scoped(
    world.a,
    world.users.owner,
    async (db) =>
      (
        await db
          .select({ id: events.eventId })
          .from(events)
          .where(
            and(
              eq(events.type, type),
              entityId ? eq(events.entityId, entityId) : undefined,
            ),
          )
      ).length,
  );
const requiredAttribute = () =>
  world.scoped(world.a, world.users.owner, async (db) => {
    const key = unique("required").replaceAll("-", "_");
    const [definition] = await db
      .insert(conversationAttributeDefinitions)
      .values({
        key,
        label: "Root cause",
        fieldType: "text",
        requiredToClose: true,
      })
      .returning({ id: conversationAttributeDefinitions.id });
    return { key, id: definition!.id };
  });
const archive = (id: string) =>
  world.scoped(world.a, world.users.owner, (db) =>
    db
      .update(conversationAttributeDefinitions)
      .set({ archivedAt: new Date() })
      .where(eq(conversationAttributeDefinitions.id, id as never)),
  );

describe.skipIf(!url)("Support conversations", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "support");
    ids = await seedA();
    foreign = await seedB();
  }, 120000);
  afterAll(() => world?.stop());

  it("hides test conversations from lists and counts, and the counts match the lists", async () => {
    const list = await owner("GET", "/conversations?limit=100");
    expect(list.status).toBe(200);
    const listed = list.body.items.map((item: { id: string }) => item.id);
    expect(listed).toEqual(
      expect.arrayContaining([
        ids.open.conversationId,
        ids.mine.conversationId,
      ]),
    );
    expect(listed).not.toContain(ids.test.conversationId);
    // Spam leaves every triage view and appears only in the spam view.
    expect(listed).not.toContain(ids.spam.conversationId);
    const spamView = await owner("GET", "/conversations?view=spam");
    expect(spamView.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids.spam.conversationId,
    ]);

    const counts = await owner("GET", "/inbox/counts");
    const mine = await owner(
      "GET",
      "/inbox?facet=open&assignee=mine&limit=100",
    );
    const unassigned = await owner(
      "GET",
      "/inbox?facet=open&assignee=unassigned&limit=100",
    );
    expect(counts.body).toEqual({
      mine: mine.body.items.length,
      unassigned: unassigned.body.items.length,
    });
    expect(counts.body.mine).toBe(1);
    expect(
      mine.body.items.map(
        (item: { conversation: { id: string } }) => item.conversation.id,
      ),
    ).toEqual([ids.mine.conversationId]);

    const tags = await owner("GET", "/conversation-tags?counts=true");
    expect(
      tags.body.items.find((tag: { id: string }) => tag.id === ids.tagId)
        ?.count,
    ).toBe(1);

    // A test conversation still opens by ID for the teammate trying it out.
    const test = await owner(
      "GET",
      `/conversations/${ids.test.conversationId}`,
    );
    expect(test.status).toBe(200);
    expect(test.body.isTest).toBe(true);
  });

  it("returns internal notes only when asked, marked as internal", async () => {
    const path = `/conversations/${ids.open.conversationId}/messages`;
    const plain = await owner("GET", path);
    expect(plain.body.items.map((m: { id: string }) => m.id)).not.toContain(
      ids.open.noteId,
    );
    expect(
      plain.body.items.every((m: { isInternal: boolean }) => !m.isInternal),
    ).toBe(true);
    const all = await owner("GET", `${path}?includeInternal=true`);
    const note = all.body.items.find(
      (m: { id: string }) => m.id === ids.open.noteId,
    );
    expect(note).toMatchObject({
      isInternal: true,
      content: "Private context",
    });
  });

  it("keeps notes out of the preview, and deleted text leaves it", async () => {
    const thread = await world.scoped(world.a, world.users.owner, (db) =>
      conversation(db, ids.ownerId, ids.visitor),
    );
    const c = thread.conversationId;
    const preview = async () =>
      (await owner("GET", `/conversations/${c}`)).body.lastMessagePreview;
    const reply = await owner("POST", `/conversations/${c}/reply`, {
      content: "Visible reply",
    });
    expect(await preview()).toBe("Visible reply");
    const note = await owner("POST", `/conversations/${c}/note`, {
      content: "Secret note",
    });
    expect(note.body.message.isInternal).toBe(true);
    expect(await preview()).toBe("Visible reply");
    await owner("PATCH", `/conversation-messages/${note.body.message.id}`, {
      content: "Secret edit",
    });
    expect(await preview()).toBe("Visible reply");
    await owner("PATCH", `/conversation-messages/${reply.body.message.id}`, {
      content: "Edited reply",
    });
    expect(await preview()).toBe("Edited reply");
    // Deleting the latest visible message drops its text from the inbox.
    await owner("DELETE", `/conversation-messages/${reply.body.message.id}`);
    expect(await preview()).toBe("On it");
    const transcript = await owner("GET", `/conversations/${c}/transcript`);
    expect(transcript.body.content).toContain("· internal note");
    expect(transcript.body.content).not.toContain("Edited reply");
  });

  it("refuses foreign and unrelated child IDs and changes nothing", async () => {
    const c = ids.open.conversationId;
    const before = await row(c);
    const denied = await Promise.all([
      owner("PATCH", `/conversation-messages/${foreign.agentMessageId}`, {
        content: "x",
      }),
      owner(
        "PUT",
        `/conversation-messages/${foreign.visitorMessageId}/reactions?emoji=${encodeURIComponent("👍")}`,
      ),
      owner("POST", `/conversations/${c}/unread`, {
        messageId: foreign.visitorMessageId,
      }),
      // Same workspace, other conversation: the message must belong to this conversation.
      owner("POST", `/conversations/${c}/unread`, {
        messageId: ids.mine.visitorMessageId,
      }),
      owner("POST", `/conversations/${c}/tags`, { tagId: foreign.tagId }),
      owner("DELETE", `/conversations/${c}/tags/${foreign.tagId}`),
      owner("POST", `/conversations/${c}/participants`, {
        principalId: foreign.visitor,
      }),
      owner("POST", `/conversations/${c}/participants`, {
        email: foreign.email,
      }),
      // A teammate is never a customer participant.
      owner("POST", `/conversations/${c}/participants`, {
        principalId: ids.memberId,
      }),
      owner("DELETE", `/conversations/${c}/participants/${foreign.visitor}`),
      owner("POST", `/conversations/${c}/note`, {
        content: "Hi",
        mentionPrincipalIds: [foreign.teammateId],
      }),
      // A body principal ID is not membership proof: the former member is refused.
      owner("POST", `/conversations/${c}/assign`, {
        assigneePrincipalId: ids.formerId,
      }),
      owner("POST", `/conversations/${c}/note`, {
        content: "Hi",
        mentionPrincipalIds: [ids.formerId],
      }),
      owner("POST", `/conversations/${c}/assign`, {
        assigneePrincipalId: foreign.teammateId,
      }),
      owner("PUT", `/conversations/${c}/team`, { teamId: foreign.teamId }),
      owner("POST", `/conversation-views`, {
        name: "Foreign",
        filters: { rules: [{ field: "tag", value: foreign.tagId }] },
      }),
    ]);
    expect(denied.map((res) => res.status)).toEqual(denied.map(() => 404));
    expect(await row(c)).toEqual(before);
    const notes = await world.scoped(world.a, world.users.owner, (db) =>
      db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, c),
            eq(conversationMessages.isInternal, true),
          ),
        ),
    );
    expect(notes).toHaveLength(1);
  });

  it("applies a bulk update to every conversation or to none", async () => {
    const both = [ids.open.conversationId, ids.mine.conversationId];
    const foreignBatch = await owner("POST", "/conversations/bulk", {
      conversationIds: [ids.open.conversationId, foreign.conversationId],
      action: { type: "priority", priority: "urgent" },
    });
    expect(foreignBatch.status).toBe(404);
    expect((await row(ids.open.conversationId))!.priority).toBe("none");

    const required = await requiredAttribute();
    try {
      // The batch locks in ID order: the first row closes (and gets a notice), the second blocks.
      const [first, second] = await world.scoped(
        world.a,
        world.users.owner,
        async (db) =>
          (
            await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(inArray(conversations.id, both))
              .orderBy(conversations.id)
          ).map((r) => r.id),
      );
      expect(
        (
          await owner(
            "PUT",
            `/conversations/${first}/attributes/${required.key}`,
            {
              value: "Fixed",
            },
          )
        ).status,
      ).toBe(200);
      const notices = await world.scoped(world.a, world.users.owner, (db) =>
        db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, first!)),
      );
      const close = await owner("POST", "/conversations/bulk", {
        conversationIds: both,
        action: { type: "close" },
      });
      expect(close.status).toBe(409);
      expect(close.body.message).toContain("Root cause");
      expect((await row(first!))!.status).toBe("open");
      expect((await row(second!))!.status).toBe("open");
      // The first row's "Conversation ended" notice was rolled back too.
      expect(
        await world.scoped(world.a, world.users.owner, (db) =>
          db
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, first!)),
        ),
      ).toHaveLength(notices.length);
    } finally {
      await archive(required.id);
    }

    const events = await eventCount("conversation.bulk_updated");
    const ok = await owner("POST", "/conversations/bulk", {
      conversationIds: both,
      action: { type: "priority", priority: "high" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.changedIds.sort()).toEqual([...both].sort());
    expect((await row(ids.open.conversationId))!.priority).toBe("high");
    expect((await row(ids.mine.conversationId))!.priority).toBe("high");
    expect(await eventCount("conversation.bulk_updated")).toBe(events + 1);

    const mixed = await owner("POST", "/conversations/bulk-delete", {
      conversationIds: [ids.spam.conversationId, ids.open.conversationId],
    });
    expect(mixed.status).toBe(409);
    expect(await row(ids.spam.conversationId)).toBeDefined();
    const foreignDelete = await owner("POST", "/conversations/bulk-delete", {
      conversationIds: [ids.spam.conversationId, foreign.conversationId],
    });
    expect(foreignDelete.status).toBe(404);
    expect(await row(ids.spam.conversationId)).toBeDefined();
  });

  it("checks the close guard and records no event for a no-op", async () => {
    const c = ids.open.conversationId;
    const assign = await owner("POST", `/conversations/${c}/assign`, {
      assigneePrincipalId: ids.memberId,
    });
    expect(assign.status).toBe(200);
    expect(assign.body).toMatchObject({
      assignedAgentPrincipalId: ids.memberId,
      changed: true,
    });
    const assigned = await eventCount("conversation.assigned", c);
    const again = await owner("POST", `/conversations/${c}/assign`, {
      assigneePrincipalId: ids.memberId,
    });
    expect(again.body.changed).toBe(false);
    expect(await eventCount("conversation.assigned", c)).toBe(assigned);

    const junk = (
      await world.scoped(world.a, world.users.owner, (db) =>
        conversation(db, ids.ownerId, ids.visitor),
      )
    ).conversationId;
    const required = await requiredAttribute();
    try {
      const blocked = await owner("POST", `/conversations/${c}/status`, {
        status: "closed",
      });
      expect(blocked.status).toBe(409);
      // Ending with a reason needs the required attributes too; filing spam does not.
      expect(
        (await owner("POST", `/conversations/${c}/end`, { reason: "resolved" }))
          .status,
      ).toBe(409);
      expect((await row(c))!.status).toBe("open");
      const spam = await owner("POST", `/conversations/${junk}/end`, {
        reason: "spam",
      });
      expect(spam.body).toMatchObject({ status: "closed", endReason: "spam" });
      await owner("PUT", `/conversations/${c}/attributes/${required.key}`, {
        value: "Done",
      });
      const closed = await owner("POST", `/conversations/${c}/status`, {
        status: "closed",
      });
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({ status: "closed", changed: true });
    } finally {
      await archive(required.id);
    }
    // A reply reopens it and stops the wait clock.
    const reply = await owner("POST", `/conversations/${c}/reply`, {
      content: "Back again",
    });
    expect(reply.body.conversation).toMatchObject({
      status: "open",
      lastMessagePreview: "Back again",
    });
    // A spam-ended thread that is reopened is no longer spam: it is back in the lists.
    const reopened = await owner("POST", `/conversations/${junk}/status`, {
      status: "open",
    });
    expect(reopened.body).toMatchObject({
      status: "open",
      endReason: null,
      spamReason: null,
    });
    const listed = await owner("GET", "/conversations?status=open&limit=100");
    expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(
      junk,
    );
  });

  it("lets only the author edit a message and keeps note events team-only", async () => {
    const edit = await member(
      "PATCH",
      `/conversation-messages/${ids.mine.agentMessageId}`,
      {
        content: "Not mine",
      },
    );
    expect(edit.status).toBe(403);
    const removed = await owner(
      "DELETE",
      `/conversation-messages/${ids.mine.noteId}`,
    );
    expect(removed.status).toBe(200);
    expect(await eventCount("message.note_deleted", ids.mine.noteId)).toBe(1);
    expect(await eventCount("message.deleted", ids.mine.noteId)).toBe(0);
    const system = await world.scoped(
      world.a,
      world.users.owner,
      async (db) => {
        const [notice] = await db
          .insert(conversationMessages)
          .values({
            conversationId: ids.mine.conversationId,
            senderType: "system",
            content: "Notice",
          })
          .returning({ id: conversationMessages.id });
        return notice!.id;
      },
    );
    expect(
      (await owner("DELETE", `/conversation-messages/${system}`)).status,
    ).toBe(409);
  });

  it("keeps a private view to its creator", async () => {
    const created = await member("POST", "/conversation-views", {
      name: "Mine only",
      filters: { rules: [{ field: "assignee", value: "me" }] },
      isShared: false,
    });
    expect(created.status).toBe(200);
    const listed = await owner("GET", "/conversation-views");
    expect(listed.body.items.map((v: { id: string }) => v.id)).not.toContain(
      created.body.id,
    );
    expect(
      (
        await owner("PATCH", `/conversation-views/${created.body.id}`, {
          name: "Taken",
        })
      ).status,
    ).toBe(404);
    expect(
      (await owner("PUT", `/conversation-views/${created.body.id}/pin`)).status,
    ).toBe(404);
    const renamed = await member(
      "PATCH",
      `/conversation-views/${created.body.id}`,
      { name: "Renamed" },
    );
    expect(renamed.body.name).toBe("Renamed");

    // Rule IDs are checked on update too, for every kind, and stored in their canonical form.
    const shared = await owner("POST", "/conversation-views", {
      name: "By tag",
      filters: { rules: [{ field: "tag", value: toUuid(ids.tagId) }] },
    });
    expect(shared.body.filters.rules).toEqual([
      { field: "tag", value: ids.tagId },
    ]);
    const denied = await Promise.all([
      owner("PATCH", `/conversation-views/${shared.body.id}`, {
        filters: { rules: [{ field: "team", value: foreign.teamId }] },
      }),
      owner("PATCH", `/conversation-views/${shared.body.id}`, {
        filters: { rules: [{ field: "assignee", value: foreign.teammateId }] },
      }),
      owner("POST", "/conversation-views", {
        name: "Foreign teammate",
        filters: { rules: [{ field: "assignee", value: foreign.teammateId }] },
      }),
    ]);
    expect(denied.map((res) => res.status)).toEqual([404, 404, 404]);
    // Only the creator shares or unshares a view.
    const unshare = await member(
      "PATCH",
      `/conversation-views/${shared.body.id}`,
      {
        isShared: false,
      },
    );
    expect(unshare.status).toBe(403);
  });

  it("tracks feedback only on boards the caller can see", async () => {
    const c = ids.mine.conversationId;
    const hidden = await member("POST", `/conversations/${c}/posts`, {
      boardId: ids.hiddenBoardId,
      title: "From support",
    });
    expect(hidden.status).toBe(404);
    expect(
      (
        await member("POST", `/conversations/${c}/share-post`, {
          postId: ids.hiddenPostId,
        })
      ).status,
    ).toBe(404);
    const tracked = await owner("POST", `/conversations/${c}/posts`, {
      boardId: ids.hiddenBoardId,
      title: "From support",
    });
    expect(tracked.status).toBe(200);
    expect(tracked.body.created).toBe(true);
    const post = await world.scoped(world.a, world.users.owner, async (db) => {
      const [found] = await db
        .select()
        .from(posts)
        .where(eq(posts.id, tracked.body.postId));
      return found!;
    });
    // The post is the visitor's, tracked by the teammate.
    expect(post).toMatchObject({
      principalId: ids.visitor,
      trackedByPrincipalId: ids.ownerId,
      voteCount: 1,
    });
    const ownerLinks = await owner("GET", `/conversations/${c}/posts`);
    expect(
      ownerLinks.body.items.map((p: { postId: string }) => p.postId),
    ).toContain(post.id);
    const memberLinks = await member("GET", `/conversations/${c}/posts`);
    expect(
      memberLinks.body.items.map((p: { postId: string }) => p.postId),
    ).not.toContain(post.id);
    expect(
      (await member("GET", `/posts/${post.id}/conversations`)).status,
    ).toBe(404);
    const linked = await owner("GET", `/posts/${post.id}/conversations`);
    expect(
      linked.body.items.map(
        (x: { conversationId: string }) => x.conversationId,
      ),
    ).toEqual([c]);
    const test = await owner(
      "POST",
      `/conversations/${ids.test.conversationId}/posts`,
      {
        boardId: ids.boardId,
        title: "Test",
      },
    );
    expect(test.status).toBe(409);
  });

  it("adds the visitor's vote to a visible post once, with the team-only context", async () => {
    const c = ids.open.conversationId;
    const votes = async () =>
      world.scoped(world.a, world.users.owner, async (db) => {
        const [post] = await db
          .select({ voteCount: posts.voteCount })
          .from(posts)
          .where(eq(posts.id, ids.openPostId));
        const comments = await db
          .select({
            isPrivate: postComments.isPrivate,
            content: postComments.content,
          })
          .from(postComments)
          .where(eq(postComments.postId, ids.openPostId));
        return { voteCount: post!.voteCount, comments };
      });
    const before = await votes();
    const denied = await Promise.all([
      member("POST", `/conversations/${c}/posts`, {
        asUpvoteOfPostId: ids.hiddenPostId,
      }),
      owner("POST", `/conversations/${c}/posts`, {
        asUpvoteOfPostId: foreign.postId,
      }),
    ]);
    expect(denied.map((res) => res.status)).toEqual([404, 404]);
    expect(await votes()).toEqual(before);

    const voted = await owner("POST", `/conversations/${c}/posts`, {
      asUpvoteOfPostId: ids.openPostId,
      sourceMessageContent: "I need this export",
    });
    expect(voted.body).toMatchObject({
      postId: ids.openPostId,
      created: false,
      voted: true,
    });
    const after = await votes();
    expect(after.voteCount).toBe(before.voteCount + 1);
    expect(after.comments).toContainEqual({
      isPrivate: true,
      content: "Tracked from a support conversation:\n\nI need this export",
    });
    expect(await eventCount("post.voted", ids.openPostId)).toBe(1);

    // The visitor already voted: no second vote; the request records the shared message.
    const again = await owner("POST", `/conversations/${c}/posts`, {
      asUpvoteOfPostId: ids.openPostId,
    });
    expect(again.body).toMatchObject({ created: false, voted: false });
    expect((await votes()).voteCount).toBe(before.voteCount + 1);
    expect(await eventCount("message.created", again.body.messageId)).toBe(1);
  });

  it("lists flags, files and value and segment counts without test conversations", async () => {
    const flag = await owner(
      "PUT",
      `/conversation-messages/${ids.mine.visitorMessageId}/flag`,
    );
    expect(flag.body.flaggedAt).not.toBeNull();
    const flagged = await owner("GET", "/conversation-messages/flagged");
    expect(flagged.body.items).toContainEqual(
      expect.objectContaining({
        messageId: ids.mine.visitorMessageId,
        conversationId: ids.mine.conversationId,
      }),
    );
    // Flags are personal.
    const memberFlags = await member("GET", "/conversation-messages/flagged");
    expect(memberFlags.body.items).toEqual([]);

    await world.scoped(world.a, world.users.owner, (db) =>
      db.insert(conversationMessages).values({
        conversationId: ids.mine.conversationId,
        principalId: ids.visitor,
        senderType: "visitor",
        content: "See attached",
        attachments: [
          {
            url: "https://files.example/a.png",
            name: "a.png",
            contentType: "image/png",
            size: 12,
          },
        ],
      }),
    );
    const files = await owner(
      "GET",
      `/conversations/${ids.mine.conversationId}/files`,
    );
    expect(files.body.items).toEqual([
      expect.objectContaining({
        name: "a.png",
        contentType: "image/png",
        size: 12,
        fileId: null,
      }),
    ]);

    const select = await owner("POST", "/conversation-attributes", {
      key: unique("topic").replaceAll("-", "_"),
      label: "Topic",
      fieldType: "select",
      options: [{ label: "Billing" }],
    });
    const option = select.body.options[0].id;
    for (const id of [ids.mine.conversationId, ids.test.conversationId])
      expect(
        (
          await owner(
            "PUT",
            `/conversations/${id}/attributes/${select.body.key}`,
            { value: option },
          )
        ).status,
      ).toBe(200);
    const counts = await owner(
      "GET",
      `/conversation-attributes/${select.body.id}/value-counts`,
    );
    expect(counts.body.items[0]).toEqual({
      optionId: option,
      label: "Billing",
      count: 1,
    });

    const segment = await world.scoped(
      world.a,
      world.users.owner,
      async (db) => {
        const tester = (await row(ids.test.conversationId))!.visitorPrincipalId;
        const [created] = await db
          .insert(segments)
          .values({
            name: unique("segment"),
            slug: unique("segment"),
            type: "manual",
          })
          .returning({ id: segments.id });
        await db.insert(userSegments).values([
          { segmentId: created!.id, principalId: ids.visitor },
          { segmentId: created!.id, principalId: tester },
        ]);
        return created!.id;
      },
    );
    const open = await owner(
      "GET",
      `/conversations?status=open&visitorPrincipalId=${ids.visitor}&limit=100`,
    );
    const listed = await owner("GET", "/inbox/segments");
    expect(
      listed.body.items.find((s: { id: string }) => s.id === segment)?.count,
    ).toBe(open.body.items.length);
  });

  it("pages messages past a cursor that was deleted", async () => {
    const path = `/conversations/${ids.mine.conversationId}/messages`;
    const first = await owner("GET", `${path}?limit=1`);
    const cursor = first.body.nextCursor;
    expect(cursor).not.toBeNull();
    await owner("DELETE", `/conversation-messages/${first.body.items[0].id}`);
    const next = await owner("GET", `${path}?limit=1&before=${cursor}`);
    expect(next.status).toBe(200);
    expect(next.body.items.map((m: { id: string }) => m.id)).not.toContain(
      cursor,
    );
  });

  it("pages every sort without duplicates or gaps", async () => {
    await world.scoped(world.a, world.users.owner, async (db) => {
      for (let n = 0; n < 5; n++) {
        const visitor = await customer(db, `${unique("page")}@example.test`);
        await conversation(db, ids.ownerId, visitor, {
          priority: (["low", "high", "urgent", "none", "medium"] as const)[n],
          waitingSince: n % 2 ? new Date(Date.now() - n * 1000) : null,
        });
      }
    });
    for (const sort of ["recent", "oldest", "created", "waiting", "priority"]) {
      const full = await owner("GET", `/conversations?sort=${sort}&limit=100`);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: {
          body: { items: { id: string }[]; nextCursor: string | null };
        } = await owner(
          "GET",
          `/conversations?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
        );
        seen.push(...page.body.items.map((item) => item.id));
        cursor = page.body.nextCursor;
      } while (cursor);
      expect(seen).toEqual(
        full.body.items.map((item: { id: string }) => item.id),
      );
      if (sort === "priority") {
        const rank = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
        const ranks = full.body.items.map(
          (item: { priority: keyof typeof rank }) => rank[item.priority],
        );
        expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
      }
    }
    expect(
      (await owner("GET", `/conversations?cursor=${foreign.conversationId}`))
        .status,
    ).toBe(404);
  });

  it("deletes only spam-ended conversations and their thread", async () => {
    const deleted = await owner("POST", "/conversations/bulk-delete", {
      conversationIds: [ids.spam.conversationId],
    });
    expect(deleted.status).toBe(200);
    expect(await row(ids.spam.conversationId)).toBeUndefined();
    const left = await world.scoped(world.a, world.users.owner, (db) =>
      db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          inArray(conversationMessages.id, [
            ids.spam.visitorMessageId,
            ids.spam.noteId,
          ]),
        ),
    );
    expect(left).toEqual([]);
  });
});
