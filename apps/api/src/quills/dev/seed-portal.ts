import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { config } from "dotenv-mono";
import { getDatabase, getDatabasePool } from "../../database";
import {
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import { withQuillsWorkspace } from "../../database/quills/client";
import { settings } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import { posts } from "../../database/quills/schema/posts";
import {
  statusComponents,
  statusIncidents,
  statusIncidentUpdates,
  statusIncidentComponents,
} from "../../database/quills/schema/status";
import { postStatuses } from "../../database/quills/schema/statuses";
import { recordQuillsChange } from "../events";
import { reconcileComponents } from "../content/status/shared";
import { seedPortalShowcase } from "./showcase";

config();

export function assertPortalSeedEnvironment(
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
) {
  if (nodeEnv === "production")
    throw new Error("Portal seed refuses NODE_ENV=production");
  if (!databaseUrl) throw new Error("Portal seed requires DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1")
    throw new Error("Portal seed requires a local PostgreSQL host");
}

const USER_ID = "quills_portal_demo_user";
const WORKSPACE_ID = "quills_portal_demo";
const FIXTURE = "quills-portal-demo-v1";

const isFixture = (metadata: string | null) => {
  try {
    return JSON.parse(metadata ?? "null")?.fixture === FIXTURE;
  } catch {
    return false;
  }
};

export async function seedPortal(reset = false) {
  assertPortalSeedEnvironment();
  const db = getDatabase();
  let [existingWorkspace] = await db
    .select({ metadata: workspaceTable.metadata })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, WORKSPACE_ID));
  const [existingMembership] = existingWorkspace
    ? await db
        .select({ userId: workspaceUserTable.userId })
        .from(workspaceUserTable)
        .where(
          and(
            eq(workspaceUserTable.workspaceId, WORKSPACE_ID),
            eq(workspaceUserTable.userId, USER_ID),
          ),
        )
    : [];
  if (
    existingWorkspace &&
    (!isFixture(existingWorkspace.metadata) || !existingMembership)
  )
    throw new Error("Portal seed workspace ID is owned by another fixture");
  if (reset && existingWorkspace) {
    await db.delete(workspaceTable).where(eq(workspaceTable.id, WORKSPACE_ID));
    existingWorkspace = undefined;
  }
  const [existingUser] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, USER_ID));
  if (existingUser && existingUser.email !== "portal-demo@example.test")
    throw new Error("Portal seed user ID belongs to another account");
  await db
    .insert(userTable)
    .values({
      id: USER_ID,
      name: "Portal Demo Owner",
      email: "portal-demo@example.test",
      emailVerified: true,
    })
    .onConflictDoNothing();
  await db
    .insert(workspaceTable)
    .values({
      id: WORKSPACE_ID,
      name: "Quills Portal Demo",
      slug: WORKSPACE_ID,
      metadata: JSON.stringify({ fixture: FIXTURE }),
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  const [membership] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, WORKSPACE_ID),
        eq(workspaceUserTable.userId, USER_ID),
      ),
    );
  if (!membership && !existingWorkspace)
    await db.insert(workspaceUserTable).values({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      role: "owner",
      joinedAt: new Date(),
    });

  return withQuillsWorkspace(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    async (quills, actor) => {
      const changed = (
        type: Parameters<typeof recordQuillsChange>[2]["type"],
        entityType: Parameters<typeof recordQuillsChange>[2]["entityType"],
        entityId: string,
      ) => recordQuillsChange(quills, actor, { type, entityType, entityId });
      await quills.update(settings).set({
        portalConfig: JSON.stringify({
          enabled: true,
          features: { allowAnonymous: true },
        }),
        featureFlags: JSON.stringify({ helpCenter: true, statusPage: true }),
        metadata: JSON.stringify({
          statusSettings: { enabled: true, audience: "public" },
        }),
        helpCenterConfig: JSON.stringify({
          locales: { default: "en", additional: [], chrome: {} },
          seo: { indexable: true, sitemapEnabled: true },
        }),
        brandingConfig: JSON.stringify({
          themeMode: "light",
          light: {
            primary: "oklch(0.55 0.2 260)",
            primaryForeground: "oklch(1 0 0)",
          },
        }),
        headerDisplayName: "Quills Portal Demo",
      });
      await changed("settings.portal_updated", "settings", WORKSPACE_ID);
      await changed("settings.branding_updated", "settings", WORKSPACE_ID);
      await changed("settings.help_center_updated", "settings", WORKSPACE_ID);
      await changed("settings.status_updated", "settings", WORKSPACE_ID);

      let [board] = await quills
        .select({ id: boards.id })
        .from(boards)
        .where(eq(boards.slug, "feedback"));
      if (!board) {
        board = (
          await quills
            .insert(boards)
            .values({ name: "Feedback", slug: "feedback" })
            .returning({ id: boards.id })
        )[0]!;
        await changed("board.created", "board", board.id);
      }
      const [status] = await quills
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true));
      const [post] = await quills
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.title, "Portal demo feedback"));
      if (!post) {
        const [created] = await quills
          .insert(posts)
          .values({
            boardId: board.id,
            title: "Portal demo feedback",
            content: "Vote and comment on this local demo post.",
            principalId: actor.principalId,
            statusId: status?.id,
          })
          .returning({ id: posts.id });
        await changed("post.created", "post", created!.id);
      }

      const [entry] = await quills
        .select({ id: changelogEntries.id })
        .from(changelogEntries)
        .where(eq(changelogEntries.title, "Portal demo shipped"));
      if (!entry) {
        const [created] = await quills
          .insert(changelogEntries)
          .values({
            title: "Portal demo shipped",
            content: "The local portal seed is ready.",
            principalId: actor.principalId,
            publishedAt: new Date(),
          })
          .returning({ id: changelogEntries.id });
        await changed("changelog.published", "changelog", created!.id);
      }

      let [component] = await quills
        .select({ id: statusComponents.id })
        .from(statusComponents)
        .where(eq(statusComponents.name, "API"));
      if (!component) {
        component = (
          await quills
            .insert(statusComponents)
            .values({ name: "API" })
            .returning({ id: statusComponents.id })
        )[0]!;
        await changed(
          "status.component_created",
          "status_component",
          component.id,
        );
      }
      let [incident] = await quills
        .select({ id: statusIncidents.id })
        .from(statusIncidents)
        .where(eq(statusIncidents.title, "Portal demo incident"));
      if (!incident) {
        const [created] = await quills
          .insert(statusIncidents)
          .values({
            kind: "incident",
            title: "Portal demo incident",
            status: "investigating",
            impact: "minor",
            createdBy: actor.principalId,
            notifySubscribers: false,
          })
          .returning({ id: statusIncidents.id });
        incident = created;
        await quills.insert(statusIncidentUpdates).values({
          incidentId: created!.id,
          status: "investigating",
          body: "We are investigating a local demo incident.",
          createdBy: actor.principalId,
        });
        await changed(
          "status.incident_published",
          "status_incident",
          created!.id,
        );
      }

      const [linked] = await quills
        .insert(statusIncidentComponents)
        .values({
          incidentId: incident!.id,
          componentId: component.id,
          componentStatus: "degraded_performance",
        })
        .onConflictDoNothing()
        .returning({ incidentId: statusIncidentComponents.incidentId });
      if (linked) {
        await reconcileComponents(
          quills,
          [component.id],
          "incident",
          incident!.id,
        );
        await changed(
          "status.incident_updated",
          "status_incident",
          incident!.id,
        );
      }

      let [category] = await quills
        .select({ id: helpCenterCategories.id })
        .from(helpCenterCategories)
        .where(eq(helpCenterCategories.slug, "getting-started"));
      if (!category) {
        category = (
          await quills
            .insert(helpCenterCategories)
            .values({ name: "Getting started", slug: "getting-started" })
            .returning({ id: helpCenterCategories.id })
        )[0]!;
        await changed(
          "help_center.category_created",
          "help_center_category",
          category.id,
        );
      }
      const [article] = await quills
        .select({ id: helpCenterArticles.id })
        .from(helpCenterArticles)
        .where(eq(helpCenterArticles.slug, "welcome"));
      if (!article) {
        const [created] = await quills
          .insert(helpCenterArticles)
          .values({
            categoryId: category.id,
            slug: "welcome",
            title: "Welcome to the portal",
            content: "This is safe, fake data for local browser checks.",
            principalId: actor.principalId,
            publishedAt: new Date(),
          })
          .returning({ id: helpCenterArticles.id });
        await changed("help_center.article_published", "article", created!.id);
      }

      await seedPortalShowcase(quills, actor);
      return { workspaceId: WORKSPACE_ID, userId: USER_ID };
    },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await seedPortal(process.argv.includes("--reset"));
    console.log(JSON.stringify(result));
  } finally {
    await getDatabasePool().end();
  }
}
