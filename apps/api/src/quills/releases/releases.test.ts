import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../../database/schema";
import { runQuillsMigrations } from "../../database/quills/migrate";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { seedSystemData } from "../../database/quills/seed-system";
import { principal, user } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { inAppNotifications } from "../../database/quills/schema/notifications";
import { postTasks } from "../../database/quills/schema/platform-links";
import { posts, postVotes } from "../../database/quills/schema/posts";
import {
  releaseNotifications,
  ticketPosts,
  verifiedReleases,
} from "../../database/quills/schema/releases";
import { postStatuses } from "../../database/quills/schema/statuses";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import {
  approveAndShipRelease,
  createVerifiedReleaseDraft,
} from "./draft-and-ship";
import { insertVisitorMessage } from "../support/customer/model";
import { createId } from "@kaneo/ids";

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

describe.skipIf(!url)("Verified release loop (#298, real PostgreSQL)", () => {
  const wsA = `ws-release-a-${Date.now()}`;
  const wsB = `ws-release-b-${Date.now()}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await runQuillsMigrations(
      url!,
      new URL("../../../drizzle/quills", import.meta.url).pathname,
    );
    const rootDb = drizzle(pool, { schema: kaneo });
    await rootDb.insert(kaneo.workspaceTable).values([
      { id: wsA, name: "Releases A", slug: wsA, createdAt: new Date() },
      { id: wsB, name: "Releases B", slug: wsB, createdAt: new Date() },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM public.workspace WHERE id IN ($1, $2)", [
        wsA,
        wsB,
      ]);
      await pool.end();
    }
  });

  it("drafts without notifying, ships on approval with strictly 1 deduplicated personal message per customer, and reopens closed tickets on reply", async () => {
    const taskId1 = `task-rel-1-${Date.now()}`;
    const taskId2 = `task-rel-2-${Date.now()}`;
    const adminUserId = `admin-user-${Date.now()}`;
    const rootDb = drizzle(pool, { schema: kaneo });
    await rootDb.insert(kaneo.userTable).values({
      id: adminUserId,
      name: "Release Manager",
      email: `${adminUserId}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await rootDb.insert(kaneo.workspaceUserTable).values({
      id: `wu-${adminUserId}`,
      workspaceId: wsA,
      userId: adminUserId,
      role: "admin",
      joinedAt: new Date(),
    });
    const projectId = `proj-rel-${Date.now()}`;
    await rootDb.insert(kaneo.projectTable).values({
      id: projectId,
      workspaceId: wsA,
      name: "Core App",
      slug: "core",
      createdAt: new Date(),
    });
    await rootDb.insert(kaneo.taskTable).values([
      {
        id: taskId1,
        projectId,
        number: 1,
        title: "Implement dark mode exports",
        status: "done",
        priority: "medium",
        createdAt: new Date(),
      },
      {
        id: taskId2,
        projectId,
        number: 2,
        title: "Add CSV UTF-8 BOM option",
        status: "done",
        priority: "low",
        createdAt: new Date(),
      },
    ]);

    const seeded = await withQuillsSystemWorkspace(wsA, async (tx) => {
      await seedSystemData(tx);

      const [adminP] = await tx
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.kaneoUserId, adminUserId))
        .limit(1);

      const [custUser] = await tx
        .insert(user)
        .values({
          name: "Alex Requester",
          email: `alex-${Date.now()}@example.com`,
        })
        .returning({ id: user.id });

      const [custP] = await tx
        .insert(principal)
        .values({
          userId: custUser!.id,
          type: "user",
          role: "user",
          displayName: "Alex Requester",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });

      const [board] = await tx
        .insert(boards)
        .values({ name: "Feature Requests", slug: "features" })
        .returning({ id: boards.id });

      const [openPostStatus] = await tx
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.slug, "open"))
        .limit(1);

      // Customer authors post1 and votes on post2; both linked to shipped tasks.
      const [post1] = await tx
        .insert(posts)
        .values({
          boardId: board!.id,
          statusId: openPostStatus!.id,
          principalId: custP!.id,
          title: "Dark mode for exports",
          content: "Please add dark mode PDF exports for client reports.",
        })
        .returning({ id: posts.id });

      const [post2] = await tx
        .insert(posts)
        .values({
          boardId: board!.id,
          statusId: openPostStatus!.id,
          principalId: adminP!.id,
          title: "CSV UTF-8 BOM option",
          content: "Preserve accented characters in Excel CSV imports.",
        })
        .returning({ id: posts.id });

      await tx.insert(postVotes).values([
        { postId: post1!.id, principalId: custP!.id },
        { postId: post2!.id, principalId: custP!.id },
      ]);

      await tx.insert(postTasks).values([
        { postId: post1!.id, taskId: taskId1 },
        { postId: post2!.id, taskId: taskId2 },
      ]);

      // Customer also has TWO open support tickets linked to these posts + a conversation on ticket1.
      const [openTicketStatus] = await tx
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.category, "open"))
        .limit(1);

      const [ticket1] = await tx
        .insert(tickets)
        .values({
          number: 101,
          title: "Need dark mode PDF exports",
          statusId: openTicketStatus!.id,
          requesterPrincipalId: custP!.id,
          type: "customer",
        })
        .returning({ id: tickets.id });

      const [ticket2] = await tx
        .insert(tickets)
        .values({
          number: 102,
          title: "Broken accented characters in CSV",
          statusId: openTicketStatus!.id,
          requesterPrincipalId: custP!.id,
          type: "customer",
        })
        .returning({ id: tickets.id });

      await tx.insert(ticketPosts).values([
        { ticketId: ticket1!.id, postId: post1!.id },
        { ticketId: ticket2!.id, postId: post2!.id },
      ]);

      const [conv] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: custP!.id,
          channel: "messenger",
          source: "widget",
          status: "closed",
          subject: "PDF export dark mode",
        })
        .returning();

      await tx.insert(ticketConversations).values({
        ticketId: ticket1!.id,
        conversationId: conv!.id,
        ticketType: "customer",
      });

      return {
        adminP: adminP!.id,
        custP: custP!.id,
        post1: post1!.id,
        post2: post2!.id,
        ticket1: ticket1!.id,
        ticket2: ticket2!.id,
        conv: conv!,
      };
    });

    // 1. Before any verified release exists (e.g., PRs merged to main only), 0 notifications exist.
    await withQuillsSystemWorkspace(wsA, async (tx) => {
      expect(await tx.select().from(releaseNotifications)).toEqual([]);
    });

    // 2. Record verified release in DRAFT mode -> changelog stays unpublished & 0 notifications sent.
    const drafted = await withQuillsSystemWorkspace(wsA, async (tx) =>
      createVerifiedReleaseDraft(tx, {
        version: "v2.4.0",
        title: "Spring Exports Release",
        source: "github_release",
        taskIds: [taskId1, taskId2],
        authorPrincipalId: seeded.adminP,
      }),
    );
    expect(drafted.created).toBe(true);
    expect(drafted.release.status).toBe("draft");
    expect(drafted.release.postIds.sort()).toEqual(
      [seeded.post1, seeded.post2].sort(),
    );
    expect(drafted.release.ticketIds.sort()).toEqual(
      [seeded.ticket1, seeded.ticket2].sort(),
    );

    await withQuillsSystemWorkspace(wsA, async (tx) => {
      const [entry] = await tx
        .select({ publishedAt: changelogEntries.publishedAt })
        .from(changelogEntries)
        .where(eq(changelogEntries.id, drafted.release.changelogEntryId!));
      expect(entry?.publishedAt).toBeNull();
      expect(await tx.select().from(releaseNotifications)).toEqual([]);
    });

    // 3. Approve & ship the verified release.
    const shipped = await withQuillsSystemWorkspace(wsA, async (tx) =>
      approveAndShipRelease(
        tx,
        {
          principalId: seeded.adminP,
          userId: "admin-user",
          workspaceId: wsA,
        },
        drafted.release.id,
        { title: "Spring Exports Release (v2.4.0)" },
      ),
    );
    expect(shipped.release.status).toBe("shipped");
    expect(shipped.shippedPostCount).toBe(2);
    expect(shipped.closedTicketCount).toBe(2);
    // Customer + admin (author of post2) => customer gets STRICTLY 1 personal message despite 2 posts + 2 tickets!
    await withQuillsSystemWorkspace(wsA, async (tx) => {
      const custNotifs = await tx
        .select()
        .from(releaseNotifications)
        .where(eq(releaseNotifications.principalId, seeded.custP));
      expect(custNotifs).toHaveLength(1);
      expect(custNotifs[0]!.postIds.sort()).toEqual(
        [seeded.post1, seeded.post2].sort(),
      );
      expect(custNotifs[0]!.ticketIds.sort()).toEqual(
        [seeded.ticket1, seeded.ticket2].sort(),
      );
      expect(custNotifs[0]!.quotedText).toContain("dark mode PDF exports");
      expect(custNotifs[0]!.body).toContain("dark mode PDF exports");

      const inApp = await tx
        .select()
        .from(inAppNotifications)
        .where(eq(inAppNotifications.principalId, seeded.custP));
      expect(inApp).toHaveLength(1);
      expect(inApp[0]!.type).toBe("release_shipped");

      // Changelog entry is now published
      const [entry] = await tx
        .select({ publishedAt: changelogEntries.publishedAt })
        .from(changelogEntries)
        .where(eq(changelogEntries.id, drafted.release.changelogEntryId!));
      expect(entry?.publishedAt).not.toBeNull();

      // Both posts are now in a 'complete' status
      const [completeStatus] = await tx
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.category, "complete"))
        .limit(1);
      const updatedPosts = await tx
        .select({ statusId: posts.statusId })
        .from(posts);
      expect(updatedPosts.every((p) => p.statusId === completeStatus!.id)).toBe(
        true,
      );

      // Ticket1 is closed now
      const [closedT1] = await tx
        .select({
          statusId: tickets.statusId,
          resolvedAt: tickets.resolvedAt,
        })
        .from(tickets)
        .where(eq(tickets.id, seeded.ticket1));
      expect(closedT1?.resolvedAt).not.toBeNull();
    });

    // 4. Customer replies on the conversation linked to closed ticket1 -> ticket1 reopens automatically!
    await withQuillsSystemWorkspace(wsA, async (tx) => {
      const [freshConv] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, seeded.conv.id));
      await insertVisitorMessage(
        tx,
        seeded.custP,
        freshConv!,
        createId("conversation_message"),
        "Thanks, dark mode works on cover page but footer is still white!",
      );

      const [reopenedT1] = await tx
        .select({
          resolvedAt: tickets.resolvedAt,
          reopenedCount: tickets.reopenedCount,
        })
        .from(tickets)
        .where(eq(tickets.id, seeded.ticket1));
      expect(reopenedT1?.resolvedAt).toBeNull();
      expect(reopenedT1?.reopenedCount).toBe(1);

      const msgs = await tx
        .select({ content: conversationMessages.content })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, seeded.conv.id));
      expect(
        msgs.some((m) => m.content.includes("footer is still white")),
      ).toBe(true);
    });

    // 5. Workspace B isolation under forced RLS
    await withQuillsSystemWorkspace(wsB, async (tx) => {
      expect(await tx.select().from(verifiedReleases)).toEqual([]);
      expect(await tx.select().from(ticketPosts)).toEqual([]);
      expect(await tx.select().from(releaseNotifications)).toEqual([]);
    });
  });
});
