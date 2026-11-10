// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { IdPrefix, SegmentId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../../openapi";
import { settings } from "../../../database/quills/schema/auth";
import {
  helpCenterCategories,
  helpCenterRedirectRules,
} from "../../../database/quills/schema/kb";
import { segments } from "../../../database/quills/schema/segments";
import type { AnyQuillsRoute } from "../../framework/define-route";
import { requireAll } from "../../feedback/id-sets";
import { parseBag } from "../../feedback/settings-json";

export type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

/** Quackback's SUPPORTED_LOCALES. */
export const locale = z.enum([
  "en",
  "de",
  "fr",
  "es",
  "ar",
  "ru",
  "pt-br",
  "zh-cn",
  "zh-tw",
  "nl",
  "pl",
  "th",
  "uk",
]);
export const DEFAULT_LOCALE = "en";

/** A deleted article or category can be restored for 30 days. */
export const RESTORE_DAYS = 30;
export const restoreCutoff = () =>
  new Date(Date.now() - RESTORE_DAYS * 24 * 60 * 60 * 1000);

/** Live rows, or with `trash` the rows deleted inside the restore window. */
export const inTrash = (deletedAt: AnyColumn, trash: boolean) =>
  trash ? gte(deletedAt, restoreCutoff()) : isNull(deletedAt);

export const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });
export const conflict = (message: string) =>
  new HTTPException(409, { message });
export const bad = (message: string) => new HTTPException(400, { message });

export const slug = z
  .string()
  .max(200)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and single hyphens",
  );

/** ASCII slug of a name, or the fallback. The source transliterates non-Latin names. */
export const slugify = (text: string, fallback: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 190)
    .replace(/-+$/, "") || fallback;

/** A full reorder list: up to 500 distinct IDs of one entity. */
export const orderList = <P extends IdPrefix>(prefix: P) =>
  z
    .array(flexibleToTypeIdSchema(prefix))
    .min(1)
    .max(500)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Each ID can appear only once",
    );

/** A unique key taken between the check and the write is the declared 409, not a 500. */
export function rethrowUnique(error: unknown, message: string): never {
  const failure = error as { code?: string; cause?: { code?: string } };
  if ((failure.cause?.code ?? failure.code) === "23505")
    throw conflict(message);
  throw error;
}

/** The base slug, or the first free `base-n`. Deleted rows keep their slugs, as the unique index does. */
export async function freeSlug(
  base: string,
  taken: (candidate: string) => Promise<boolean>,
) {
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw conflict("The slug is taken");
}

/** Every segment exists and is live in this workspace. */
export async function requireSegments(db: Db, ids: SegmentId[] | undefined) {
  if (ids?.length)
    requireAll(
      ids,
      await db
        .select({ id: segments.id })
        .from(segments)
        .where(and(inArray(segments.id, ids), isNull(segments.deletedAt))),
      "Segment",
    );
}

/**
 * The live General category, created on first use: an article saved with no category files there.
 * A deleted General keeps its slug, so a new one takes a free suffixed slug.
 */
export async function defaultCategoryId(db: Db) {
  // `general`, or a `general-n` made after a deleted General kept the plain slug.
  const live = () =>
    db
      .select({ id: helpCenterCategories.id })
      .from(helpCenterCategories)
      .where(
        and(
          isNull(helpCenterCategories.deletedAt),
          or(
            eq(helpCenterCategories.slug, "general"),
            and(
              eq(helpCenterCategories.name, "General"),
              sql`${helpCenterCategories.slug} ~ '^general-[0-9]+$'`,
            ),
          ),
        ),
      )
      .orderBy(
        asc(helpCenterCategories.createdAt),
        asc(helpCenterCategories.id),
      )
      .limit(1);
  const [existing] = await live();
  if (existing) return existing.id;
  const name = await freeSlug(
    "general",
    async (candidate) =>
      (
        await db
          .select({ id: helpCenterCategories.id })
          .from(helpCenterCategories)
          .where(eq(helpCenterCategories.slug, candidate))
      ).length > 0,
  );
  const [created] = await db
    .insert(helpCenterCategories)
    .values({ name: "General", slug: name })
    .onConflictDoNothing()
    .returning({ id: helpCenterCategories.id });
  if (created) return created.id;
  // A concurrent first save created it.
  const [raced] = await live();
  if (!raced) throw conflict("The General category is being created; retry");
  return raced.id;
}

/** Redirect rules have no foreign key to their polymorphic target, so a delete removes them here. */
export async function deleteRedirectRules(
  db: Db,
  targetType: "article" | "category",
  ids: string[],
) {
  if (ids.length)
    await db
      .delete(helpCenterRedirectRules)
      .where(
        and(
          eq(helpCenterRedirectRules.targetType, targetType),
          inArray(helpCenterRedirectRules.targetId, ids),
        ),
      );
}

const chrome = z.object({
  homepageTitle: z.string(),
  homepageDescription: z.string(),
  searchPlaceholder: z.string(),
});
/** Keeps the valid elements of a stored list, so one bad entry does not drop the rest. */
const each = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );
/** The stored help-center config. Each value falls back to its default when it is invalid. */
const stored = z.object({
  homepageTitle: z.string().catch("How can we help?"),
  homepageDescription: z
    .string()
    .catch("Search our knowledge base or browse by category"),
  headerLinks: each(z.object({ label: z.string(), url: z.string() })),
  locales: z
    .looseObject({
      default: z.string().catch(DEFAULT_LOCALE),
      additional: each(locale),
      chrome: z
        .record(z.string(), z.unknown())
        .catch({})
        .transform((entries) =>
          Object.fromEntries(
            Object.entries(entries).flatMap(([code, value]) => {
              const parsed = chrome.safeParse(value);
              return parsed.success ? [[code, parsed.data]] : [];
            }),
          ),
        ),
    })
    .catch({ default: DEFAULT_LOCALE, additional: [], chrome: {} }),
  autoTranslate: z
    .looseObject({
      enabled: z.boolean().catch(false),
      protectedTerms: each(z.string()),
    })
    .catch({ enabled: false, protectedTerms: [] }),
  seo: z
    .looseObject({
      metaDescription: z.string().catch(""),
      sitemapEnabled: z.boolean().catch(true),
      structuredDataEnabled: z.boolean().catch(true),
      indexable: z.boolean().catch(true),
    })
    .catch({
      metaDescription: "",
      sitemapEnabled: true,
      structuredDataEnabled: true,
      indexable: true,
    }),
});
export type HelpCenterConfig = z.output<typeof stored>;

const resolve = (bag: Record<string, unknown> | null) =>
  stored.parse(bag ?? {});

/** The help-center config with defaults. A malformed column reads as the defaults. */
export async function readConfig(db: Db): Promise<HelpCenterConfig> {
  const [row] = await db
    .select({ text: settings.helpCenterConfig })
    .from(settings);
  return resolve(parseBag(row?.text ?? null));
}

/**
 * Changes the config under the settings row lock. Only the sections that `change` returns are
 * written; the others, and keys this module does not own (the domain), stay as stored.
 */
export async function writeConfig(
  db: Db,
  change: (config: HelpCenterConfig) => Partial<HelpCenterConfig>,
): Promise<HelpCenterConfig> {
  const [row] = await db
    .select({ id: settings.id, text: settings.helpCenterConfig })
    .from(settings)
    .for("update");
  if (!row) throw new Error("Quills workspace was not initialized");
  const bag = parseBag(row.text);
  if (!bag)
    throw conflict(
      "Stored help-center settings are not a JSON object; they were left unchanged",
    );
  const next = { ...bag, ...change(resolve(bag)) };
  await db
    .update(settings)
    .set({ helpCenterConfig: JSON.stringify(next) })
    .where(eq(settings.id, row.id));
  return resolve(next);
}
