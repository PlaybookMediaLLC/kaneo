import { and, asc, eq, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { principal, user } from "../../database/quills/schema/auth";
import type { Database } from "../framework/define-route";
import { coerceAttributes, mergeMetadata } from "./customer";

// Customer identity by email or external ID, shared by the identify route and the sidebar app routes.

export const byEmail = (address: string) =>
  sql`lower(${user.email}) = ${address.toLowerCase()}`;

export async function emailTaken(
  db: Database,
  address: string,
  exceptUserId?: string,
) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        byEmail(address),
        exceptUserId
          ? ne(user.id, exceptUserId as typeof user.$inferSelect.id)
          : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Creates or updates a customer by external ID or email, and its principal. An external ID match
 * wins over an email match. 409 when the match belongs to a teammate or the email is taken.
 */
export async function identifyCustomer(
  db: Database,
  input: {
    email: string;
    name?: string;
    image?: string;
    emailVerified?: boolean;
    externalId?: string;
    attributes?: Record<string, string | number | boolean | null>;
  },
) {
  const attributes = await coerceAttributes(db, input.attributes ?? {});
  const [match] = await db
    .select({
      id: user.id,
      kaneoUserId: user.kaneoUserId,
      metadata: user.metadata,
    })
    .from(user)
    .where(
      input.externalId
        ? or(eq(user.externalId, input.externalId), byEmail(input.email))
        : byEmail(input.email),
    )
    // An external ID match wins over an email match.
    .orderBy(
      input.externalId
        ? sql`(${user.externalId} = ${input.externalId}) desc`
        : asc(user.createdAt),
    )
    .limit(1)
    .for("update");
  if (match?.kaneoUserId)
    throw new HTTPException(409, {
      message: "The email or external ID belongs to a teammate",
    });
  if (
    match &&
    input.externalId &&
    (await emailTaken(db, input.email, match.id))
  )
    throw new HTTPException(409, { message: "Email already in use" });
  const fields = {
    email: input.email,
    name: input.name,
    image: input.image,
    emailVerified: input.emailVerified,
    externalId: input.externalId,
    metadata: mergeMetadata(match?.metadata ?? null, attributes),
  };
  const [identity] = match
    ? await db
        .update(user)
        .set(fields)
        .where(eq(user.id, match.id))
        .returning({ id: user.id, name: user.name, image: user.image })
    : await db
        .insert(user)
        .values({
          ...fields,
          name: input.name ?? input.email.split("@")[0]!,
          emailVerified: input.emailVerified ?? false,
        })
        .returning({ id: user.id, name: user.name, image: user.image });
  const [existing] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(eq(principal.userId, identity!.id))
    .limit(1);
  const principalId = existing
    ? existing.id
    : (
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
          .returning({ id: principal.id })
      )[0]!.id;
  if (existing)
    await db
      .update(principal)
      .set({ displayName: identity!.name, avatarUrl: identity!.image })
      .where(eq(principal.id, principalId));
  return { principalId, created: !existing };
}
