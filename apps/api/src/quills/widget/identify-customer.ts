import { and, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import type { Database } from "../../database/quills/client";
import { mergeMetadata } from "../directory/customer";
import type { verifyIdentityToken } from "../framework/audience";
import {
  attributeClaims,
  autoSubscribeChangelog,
  claimedAttributes,
  linkClaimedCompany,
  reconcileClaimedSegments,
  type IdentifyWarning,
} from "./identify-claims";

// The customer that a verified host token names: the widget's identify and the portal's SSO
// sign-in (portal/token-sign-in.ts) both find or create it here.

// sub and email are required; a bad optional claim is dropped instead of failing identify.
const claimsSchema = z.object({
  sub: z
    .union([z.string(), z.number().transform(String)])
    .pipe(z.string().trim().min(1).max(255)),
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(200).optional().catch(undefined),
  avatarUrl: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u))
    .optional()
    .catch(undefined),
});

type Raw = NonNullable<ReturnType<typeof verifyIdentityToken>>;

/** Parses the required (sub/id, email) and optional (name, avatarUrl) claims of a verified token. */
export function parseCoreIdentityClaims(raw: Raw) {
  const fullName = [raw.firstName, raw.lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
  const claims = claimsSchema.safeParse({
    sub: raw.sub ?? raw.id,
    email: raw.email,
    name: raw.name ?? (fullName || undefined),
    avatarUrl: raw.avatarURL ?? raw.avatarUrl ?? raw.avatar,
  });
  if (!claims.success)
    throw new HTTPException(403, {
      message: "The ssoToken needs a sub (or id) and a valid email claim",
    });
  return {
    sub: claims.data.sub,
    email: claims.data.email.toLowerCase(),
    name: claims.data.name,
    avatarUrl: claims.data.avatarUrl,
  };
}

/** Finds or creates the customer and principal that `raw` names, and applies its claims. */
export async function identifyCustomer(db: Database, raw: Raw) {
  const { sub, email, name, avatarUrl } = parseCoreIdentityClaims(raw);

  // Two identifies of a new visitor at once would both insert; take the sub and the email in order.
  for (const key of [`sub:${sub}`, `email:${email}`])
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`quills-identify:${key}`}))`,
    );
  // The signed sub is the durable key; the signed email is the fallback for a first visit.
  const [match] = await db
    .select({
      id: customer.id,
      kaneoUserId: customer.kaneoUserId,
      email: customer.email,
      externalId: customer.externalId,
    })
    .from(customer)
    .where(
      sql`${customer.externalId} = ${sub} OR lower(${customer.email}) = ${email}`,
    )
    // A NULL external ID must not sort before the sub match (DESC puts NULLs first).
    .orderBy(sql`(${customer.externalId} = ${sub}) desc nulls last`)
    .limit(1)
    .for("update");
  // A profile linked to a Kaneo account (a verified-email link, portal/widget-link.ts, or a token
  // sign-in, portal/token-sign-in.ts) resolves only by the sub and email together, and the token
  // never changes its name, email or avatar.
  const linked = Boolean(match?.kaneoUserId);
  if (
    linked &&
    (match!.externalId !== sub || match!.email?.toLowerCase() !== email)
  )
    throw new HTTPException(409, {
      message: "The email belongs to another customer",
    });
  if (!linked && match && match.email?.toLowerCase() !== email) {
    const [holder] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(
        and(
          sql`lower(${customer.email}) = ${email}`,
          ne(customer.id, match.id),
        ),
      )
      .limit(1);
    if (holder)
      throw new HTTPException(409, {
        message: "The email belongs to another customer",
      });
  }
  const fields = {
    email,
    emailVerified: true,
    externalId: sub,
    ...(name && { name }),
    ...(avatarUrl && { image: avatarUrl }),
  };
  const [identity] = linked
    ? await db.select().from(customer).where(eq(customer.id, match!.id))
    : match
      ? await db
          .update(customer)
          .set(fields)
          .where(eq(customer.id, match.id))
          .returning()
      : await db
          .insert(customer)
          .values({ ...fields, name: name ?? email.split("@")[0]! })
          .returning();
  await db
    .insert(principal)
    .values({
      userId: identity!.id,
      role: "user",
      type: "user",
      displayName: identity!.name,
      avatarUrl: identity!.image,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  const [person] = await db
    .select({ id: principal.id, blockedAt: principal.blockedAt })
    .from(principal)
    .where(eq(principal.userId, identity!.id))
    .limit(1);
  if (person!.blockedAt)
    throw new HTTPException(403, { message: "This account is blocked" });
  await db
    .update(principal)
    .set({ displayName: identity!.name, avatarUrl: identity!.image })
    .where(eq(principal.id, person!.id));
  // The row is locked (FOR UPDATE above) or new, so this merge cannot lose a concurrent write.
  const warnings: IdentifyWarning[] = [];
  const { set: attributes, ignored } = await claimedAttributes(
    db,
    attributeClaims(raw),
  );
  for (const field of ignored)
    warnings.push({ code: "ATTRIBUTE_IGNORED", field });
  if (Object.keys(attributes).length)
    await db
      .update(customer)
      .set({
        metadata: mergeMetadata(identity!.metadata, {
          set: attributes,
          remove: [],
        }),
      })
      .where(eq(customer.id, identity!.id));
  for (const slug of await reconcileClaimedSegments(
    db,
    person!.id,
    raw.segments,
  ))
    warnings.push({ code: "SEGMENT_IGNORED", field: `segments:${slug}` });
  warnings.push(...(await linkClaimedCompany(db, person!.id, raw.companies)));
  await autoSubscribeChangelog(db, person!.id);
  return { identity: identity!, person: person!, warnings };
}
