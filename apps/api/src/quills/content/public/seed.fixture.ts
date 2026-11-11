import { settings } from "../../../database/quills/schema/auth";
import {
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategories,
  helpCenterCategoryTranslations,
  helpCenterRedirectRules,
} from "../../../database/quills/schema/kb";
import { segments } from "../../../database/quills/schema/segments";
import {
  statusComponentEvents,
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
  statusIncidentUpdates,
} from "../../../database/quills/schema/status";
import type { StatusComponentId } from "@kaneo/ids";
import type { ContractEnv } from "../../framework/contract";

// Seed helpers shared by the public help-center, status and widget help fixtures and tests.

const bag = (text: string | null): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/**
 * Opens a workspace's public surfaces: a public, enabled portal, the help-center and status
 * modules, a published public status page, German as an extra help-center locale and the widget.
 * Other keys of each settings column stay as stored.
 */
export async function openPublic(env: ContractEnv, workspaceId = env.a) {
  await env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .select({
        portalConfig: settings.portalConfig,
        featureFlags: settings.featureFlags,
        metadata: settings.metadata,
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings);
    const { access: _private, ...portal } = bag(row!.portalConfig);
    await db.update(settings).set({
      portalConfig: JSON.stringify({ ...portal, enabled: true }),
      featureFlags: JSON.stringify({
        ...bag(row!.featureFlags),
        helpCenter: true,
        statusPage: true,
      }),
      metadata: JSON.stringify({
        ...bag(row!.metadata),
        statusSettings: { enabled: true, audience: "public" },
      }),
      helpCenterConfig: JSON.stringify({
        locales: { default: "en", additional: ["de"], chrome: {} },
      }),
      widgetConfig: JSON.stringify({
        ...bag(row!.widgetConfig),
        enabled: true,
      }),
      widgetSecret: row!.widgetSecret ?? `wgt_${env.id("secret")}`,
    });
  });
}

const slugOf = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Public help content in a workspace, next to rows that must never be public: a draft, a deleted
 * and a scheduled article, a private and a gated category, a gated article, a published
 * translation of a draft and a draft translation. `hidden` lists their unique titles.
 */
export const helpContentIn = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const label = env.id("hc");
    const [segment] = await db
      .insert(segments)
      .values({ name: `${label} segment`, slug: slugOf(`${label}-segment`) })
      .returning({ id: segments.id });
    const category = async (
      name: string,
      values: Partial<typeof helpCenterCategories.$inferInsert> = {},
    ) =>
      (
        await db
          .insert(helpCenterCategories)
          .values({
            name: `${label} ${name}`,
            slug: slugOf(`${label}-${name}`),
            ...values,
          })
          .returning({
            id: helpCenterCategories.id,
            urlId: helpCenterCategories.urlId,
            slug: helpCenterCategories.slug,
          })
      )[0]!;
    const article = async (
      title: string,
      categoryId: typeof helpCenterCategories.$inferSelect.id,
      values: Partial<typeof helpCenterArticles.$inferInsert> = {},
    ) =>
      (
        await db
          .insert(helpCenterArticles)
          .values({
            categoryId,
            title: `${label} ${title}`,
            slug: slugOf(`${label}-${title}`),
            content: `${label} ${title} body`,
            principalId: actor.principalId,
            publishedAt: new Date(Date.now() - 60000),
            ...values,
          })
          .returning({
            id: helpCenterArticles.id,
            urlId: helpCenterArticles.urlId,
            slug: helpCenterArticles.slug,
          })
      )[0]!;
    const visible = await category("public");
    const privateCategory = await category("private category", {
      isPublic: false,
    });
    const gatedCategory = await category("gated category", {
      segmentIds: [segment!.id],
    });
    const published = await article("published", visible.id);
    const second = await article("second", visible.id);
    const draft = await article("draft", visible.id, { publishedAt: null });
    await article("deleted", visible.id, { deletedAt: new Date() });
    await article("scheduled", visible.id, {
      publishedAt: new Date(Date.now() + 86400000),
    });
    await article("in private", privateCategory.id);
    await article("in gated", gatedCategory.id);
    await article("gated article", visible.id, { segmentIds: [segment!.id] });
    await db.insert(helpCenterArticleTranslations).values([
      {
        articleId: published.id,
        locale: "de",
        title: `${label} veroeffentlicht`,
        content: `${label} Inhalt`,
        status: "published",
      },
      {
        articleId: draft.id,
        locale: "de",
        title: `${label} entwurf uebersetzt`,
        content: "Entwurf",
        status: "published",
      },
      {
        articleId: second.id,
        locale: "de",
        title: `${label} draft translation`,
        content: "Entwurf",
        status: "draft",
      },
    ]);
    await db.insert(helpCenterCategoryTranslations).values({
      categoryId: visible.id,
      locale: "de",
      name: `${label} oeffentlich`,
    });
    const redirectPath = `/${slugOf(label)}-old`;
    await db.insert(helpCenterRedirectRules).values({
      path: redirectPath,
      targetType: "article",
      targetId: published.id,
    });
    const [vote] = await db
      .insert(helpCenterArticleFeedback)
      .values({ articleId: published.id, principalId: null, helpful: false })
      .returning({ id: helpCenterArticleFeedback.id });
    return {
      label,
      segmentId: segment!.id,
      category: visible,
      published,
      draftId: draft.id,
      /** Categories that hold only non-public articles for an anonymous visitor. */
      closedCategoryIds: [privateCategory.id, gatedCategory.id],
      voteId: vote!.id,
      redirectPath,
      hidden: [
        "draft",
        "deleted",
        "scheduled",
        "private category",
        "gated category",
        "in private",
        "in gated",
        "gated article",
        "entwurf uebersetzt",
        "draft translation",
      ].map((title) => `${label} ${title}`),
      /** Slugs of articles and categories that are never public, and the German paths of untranslated articles. */
      hiddenPaths: [
        ...[
          "draft",
          "deleted",
          "scheduled",
          "private-category",
          "gated-category",
          "in-private",
          "in-gated",
          "gated-article",
        ].map((name) => `${slugOf(label)}-${name}`),
        `/hc/de/articles/${second.urlId}-`,
        `/hc/de/articles/${draft.urlId}-`,
      ],
    };
  });

/** Help content in A, help content in B (whose titles are hidden too), and A's surfaces open. */
export async function helpSeed(env: ContractEnv) {
  await openPublic(env);
  const a = await helpContentIn(env, env.a);
  const b = await helpContentIn(env, env.b);
  return { a, b, hidden: [...a.hidden, `${b.label} published`] };
}
export type HelpIds = Awaited<ReturnType<typeof helpSeed>>;

/**
 * A public and a gated component, a deleted one, and incidents: a public one, one that links only
 * the gated component, one that links only the deleted component, a deleted one and a resolved one.
 */
export const statusContentIn = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const label = env.id("status");
    const [segment] = await db
      .insert(segments)
      .values({ name: `${label} segment`, slug: slugOf(`${label}-segment`) })
      .returning({ id: segments.id });
    const [up, gated, gone] = await db
      .insert(statusComponents)
      .values([
        { name: `${label} public component`, status: "degraded_performance" },
        {
          name: `${label} gated component`,
          status: "major_outage",
          segmentIds: [segment!.id],
        },
        { name: `${label} deleted component`, deletedAt: new Date() },
      ])
      .returning({ id: statusComponents.id });
    await db.insert(statusComponentEvents).values({
      componentId: up!.id,
      status: "degraded_performance",
      source: "manual",
    });
    const incident = async (
      title: string,
      componentIds: StatusComponentId[],
      values: Partial<typeof statusIncidents.$inferInsert> = {},
    ) => {
      const [row] = await db
        .insert(statusIncidents)
        .values({
          kind: "incident",
          status: "investigating",
          impact: "critical",
          title: `${label} ${title}`,
          createdBy: actor.principalId,
          ...values,
        })
        .returning({ id: statusIncidents.id });
      if (componentIds.length)
        await db.insert(statusIncidentComponents).values(
          componentIds.map((componentId) => ({
            incidentId: row!.id,
            componentId,
            componentStatus:
              componentId === gated!.id
                ? ("major_outage" as const)
                : ("degraded_performance" as const),
          })),
        );
      await db.insert(statusIncidentUpdates).values({
        incidentId: row!.id,
        status: values.status ?? "investigating",
        body: `${label} ${title} update`,
        createdBy: actor.principalId,
      });
      return row!.id;
    };
    const open = await incident("public incident", [up!.id, gated!.id]);
    const privateId = await incident("private incident", [gated!.id]);
    await incident("resolved private incident", [gated!.id], {
      status: "resolved",
      resolvedAt: new Date(),
    });
    await incident("orphan incident", [gone!.id]);
    await incident("deleted incident", [up!.id], { deletedAt: new Date() });
    const resolved = await incident("resolved incident", [up!.id], {
      status: "resolved",
      resolvedAt: new Date(),
    });
    return {
      label,
      segmentId: segment!.id,
      componentId: up!.id,
      gatedComponentId: gated!.id,
      incidentId: open,
      resolvedId: resolved,
      privateId,
      hidden: [
        ...[
          "gated component",
          "deleted component",
          "private incident",
          "resolved private incident",
          "orphan incident",
          "deleted incident",
        ].map((title) => `${label} ${title}`),
        gated!.id,
        privateId,
      ],
    };
  });

/** Status content in A and B (whose component name is hidden too), and A's surfaces open. */
export async function statusSeed(env: ContractEnv) {
  await openPublic(env);
  const a = await statusContentIn(env, env.a);
  const b = await statusContentIn(env, env.b);
  return { a, b, hidden: [...a.hidden, `${b.label} public component`] };
}
export type StatusIds = Awaited<ReturnType<typeof statusSeed>>;
