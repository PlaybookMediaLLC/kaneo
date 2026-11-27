import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { companies } from "../../database/quills/schema/companies";
import { postVotes, posts } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { coerce } from "../directory/customer";
import type { Database } from "../framework/define-route";
import { readSettingsKey } from "../feedback/settings-json";

// Route-module helper: the optional claims of a signed identify token. The token is signed with
// the widget secret, so the host app vouches for each claim; each is still bounded and validated,
// and a bad value is dropped instead of failing identify (as in the source).

/** Identity fields and JWT metadata: never custom attributes. */
const RESERVED = new Set([
  "sub",
  "id",
  "email",
  "name",
  "avatarURL",
  "avatarUrl",
  "avatar",
  "firstName",
  "lastName",
  "segments",
  "companies",
  "traits",
  "exp",
  "iat",
  "nbf",
  "iss",
  "aud",
  "jti",
]);
const MAX_ATTRIBUTES = 50;
const MAX_SEGMENTS = 50;

/** A claim that identify received but did not apply. The call still succeeds. */
export type IdentifyWarning = {
  code:
    | "ATTRIBUTE_IGNORED"
    | "SEGMENT_IGNORED"
    | "COMPANY_IGNORED"
    | "COMPANY_DOMAIN_IGNORED";
  field: string;
};

/** The custom attribute candidates: top-level claims, then a `traits` object (top level wins). */
export function attributeClaims(claims: Record<string, unknown>) {
  const traits =
    claims.traits &&
    typeof claims.traits === "object" &&
    !Array.isArray(claims.traits)
      ? (claims.traits as Record<string, unknown>)
      : {};
  return { ...traits, ...claims };
}

/**
 * Custom claims that match a user attribute definition, coerced to its type. Others are dropped and
 * reported in `ignored`: a definition is created by a teammate, never by a host token.
 */
export async function claimedAttributes(
  db: Database,
  claims: Record<string, unknown>,
) {
  const values = new Map<string, string | number | boolean>();
  for (const [key, value] of Object.entries(claims)) {
    if (values.size >= MAX_ATTRIBUTES) break;
    if (RESERVED.has(key) || key.startsWith("_") || key.length > 64) continue;
    if (
      (typeof value === "string" && value.length <= 1000) ||
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    )
      values.set(key, value);
  }
  if (!values.size) return { set: {}, ignored: [] as string[] };
  const definitions = await db
    .select({
      key: userAttributeDefinitions.key,
      type: userAttributeDefinitions.type,
    })
    .from(userAttributeDefinitions)
    .where(inArray(userAttributeDefinitions.key, [...values.keys()]));
  const set: Record<string, string | number | boolean> = {};
  for (const { key, type } of definitions) {
    const coerced = coerce(values.get(key)!, type);
    if (coerced !== undefined) set[key] = coerced;
  }
  return { set, ignored: [...values.keys()].filter((key) => !(key in set)) };
}

function parseSegmentSlugs(claim: unknown) {
  return [
    ...new Set(
      (Array.isArray(claim) ? claim : []).filter(
        (slug): slug is string =>
          typeof slug === "string" && slug.length > 0 && slug.length <= 100,
      ),
    ),
  ].slice(0, MAX_SEGMENTS);
}

/** Read-only check of the `segments` claim against this workspace's manual segments. */
export async function previewClaimedSegments(db: Database, claim: unknown) {
  const slugs = parseSegmentSlugs(claim);
  const found = slugs.length
    ? await db
        .select({ slug: segments.slug })
        .from(segments)
        .where(
          and(
            inArray(segments.slug, slugs),
            eq(segments.type, "manual"),
            isNull(segments.deletedAt),
          ),
        )
    : [];
  const known = new Set(found.map((row) => row.slug));
  return {
    applied: slugs.filter((slug) => known.has(slug)),
    ignored: slugs.filter((slug) => !known.has(slug)),
  };
}

/**
 * Makes the person's widget-sourced memberships match the `segments` claim (manual segments by
 * slug; unknown slugs are dropped). A missing claim removes every widget-sourced membership, so a
 * customer who lost a plan loses its segment. Memberships from other sources stay.
 */
export async function reconcileClaimedSegments(
  db: Database,
  principalId: PrincipalId,
  claim: unknown,
) {
  const slugs = parseSegmentSlugs(claim);
  const found = slugs.length
    ? await db
        .select({ id: segments.id, slug: segments.slug })
        .from(segments)
        .where(
          and(
            inArray(segments.slug, slugs),
            eq(segments.type, "manual"),
            isNull(segments.deletedAt),
          ),
        )
    : [];
  const wanted = found.map((row) => row.id);
  await db
    .delete(userSegments)
    .where(
      and(
        eq(userSegments.principalId, principalId),
        eq(userSegments.addedBy, "widget"),
        ...(wanted.length ? [notInArray(userSegments.segmentId, wanted)] : []),
      ),
    );
  if (wanted.length)
    await db
      .insert(userSegments)
      .values(
        wanted.map((segmentId) => ({
          principalId,
          segmentId,
          addedBy: "widget" as const,
        })),
      )
      .onConflictDoNothing();
  const known = new Set(found.map((row) => row.slug));
  return slugs.filter((slug) => !known.has(slug));
}

const companyClaim = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, name, domain } = value as Record<string, unknown>;
  const external =
    typeof id === "number"
      ? String(id)
      : typeof id === "string"
        ? id.trim()
        : "";
  if (!external || external.length > 255) return null;
  return {
    externalId: external,
    name:
      typeof name === "string" && name.trim()
        ? name.trim().slice(0, 200)
        : external,
    domain:
      typeof domain === "string" && /^[a-z0-9.-]{1,253}$/i.test(domain.trim())
        ? domain.trim().toLowerCase()
        : null,
  };
};

async function lookupCompanyAndDomain(
  db: Database,
  company: NonNullable<ReturnType<typeof companyClaim>>,
) {
  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.externalId, company.externalId))
    .limit(1);
  const domainTaken =
    Boolean(company.domain) &&
    (
      await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            sql`lower(${companies.domain}) = ${company.domain}`,
            ...(existing ? [ne(companies.id, existing.id)] : []),
          ),
        )
        .limit(1)
    ).length > 0;
  return { existing, domainTaken };
}

function parseCompaniesClaim(claim: unknown) {
  if (!Array.isArray(claim) || !claim.length)
    return { company: null, warnings: [] as IdentifyWarning[] };
  const warnings: IdentifyWarning[] = claim.slice(1).map((_, index) => ({
    code: "COMPANY_IGNORED" as const,
    field: `companies[${index + 1}]`,
  }));
  const company = companyClaim(claim[0]);
  if (!company)
    return {
      company: null,
      warnings: [
        { code: "COMPANY_IGNORED" as const, field: "companies[0]" },
        ...warnings,
      ],
    };
  return { company, warnings };
}

/** Read-only validation of the `companies` claim without creating or updating any row. */
export async function previewClaimedCompany(
  db: Database,
  claim: unknown,
): Promise<{
  company: { id: string; name: string; domain: string | null } | null;
  warnings: IdentifyWarning[];
}> {
  const { company, warnings } = parseCompaniesClaim(claim);
  if (!company) return { company: null, warnings };
  const { domainTaken } = await lookupCompanyAndDomain(db, company);
  if (domainTaken)
    warnings.unshift({
      code: "COMPANY_DOMAIN_IGNORED",
      field: "companies[0].domain",
    });
  return {
    company: {
      id: company.externalId,
      name: company.name,
      domain: domainTaken ? null : company.domain,
    },
    warnings,
  };
}

/**
 * Links the person to the first company of the `companies` claim, created or updated by its
 * external ID. A person has one company: the others are reported. A domain that another company
 * holds is left out. A missing claim leaves the current company alone.
 */
export async function linkClaimedCompany(
  db: Database,
  principalId: PrincipalId,
  claim: unknown,
): Promise<IdentifyWarning[]> {
  const { company, warnings } = parseCompaniesClaim(claim);
  if (!company) return warnings;
  // Two identifies naming a new company at once would both insert.
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`quills-company:${company.externalId}`}))`,
  );
  const { existing, domainTaken } = await lookupCompanyAndDomain(db, company);
  if (domainTaken)
    warnings.unshift({
      code: "COMPANY_DOMAIN_IGNORED",
      field: "companies[0].domain",
    });
  const fields = {
    name: company.name,
    ...(company.domain && !domainTaken && { domain: company.domain }),
  };
  const [row] = existing
    ? await db
        .update(companies)
        .set(fields)
        .where(eq(companies.id, existing.id))
        .returning({ id: companies.id })
    : await db
        .insert(companies)
        .values({ ...fields, externalId: company.externalId })
        .returning({ id: companies.id });
  await db
    .update(principal)
    .set({ companyId: row!.id })
    .where(eq(principal.id, principalId));
  return warnings;
}

/**
 * Subscribes the person to the changelog when the workspace auto-subscribes (the default). A person
 * who unsubscribed keeps their row and is never subscribed again here.
 */
export async function autoSubscribeChangelog(
  db: Database,
  principalId: PrincipalId,
) {
  const stored = await readSettingsKey(db, "metadata", "changelogSettings");
  const autoSubscribe =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as { autoSubscribe?: unknown }).autoSubscribe
      : undefined;
  if (autoSubscribe === false) return;
  await db
    .insert(changelogSubscriptions)
    .values({ principalId, source: "auto" })
    .onConflictDoNothing();
}

// ponytail: the newest 500 votes; page them if widget users vote more than that.
const MAX_VOTED = 500;

/** The live posts the person voted on, newest vote first. */
export async function votedPostIds(db: Database, principalId: PrincipalId) {
  const rows = await db
    .select({ postId: postVotes.postId })
    .from(postVotes)
    .innerJoin(posts, eq(posts.id, postVotes.postId))
    .where(and(eq(postVotes.principalId, principalId), isNull(posts.deletedAt)))
    .orderBy(desc(postVotes.createdAt))
    .limit(MAX_VOTED);
  return rows.map((row) => row.postId);
}
