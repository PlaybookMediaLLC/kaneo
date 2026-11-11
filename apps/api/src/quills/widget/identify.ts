import { and, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { mintWidgetSession, verifyIdentityToken } from "../framework/audience";
import { mergeMetadata } from "../directory/customer";
import { parseJson } from "../settings/area";
import {
  autoSubscribeChangelog,
  claimedAttributes,
  reconcileClaimedSegments,
  votedPostIds,
} from "./identify-claims";

// Verified-only identify: the host app's backend signs an HS256 JWT with the widget secret,
// and only that token can name a customer. There is no unverified email path.

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

const identify = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  method: "post",
  path: "/widget/identify",
  operationId: "identifyQuillsWidgetVisitor",
  summary: "Identify a widget visitor with a signed token",
  description:
    "Creates or updates the customer that the host app's signed ssoToken names and returns a widget session token for the Authorization header. The token needs sub (or id), email and exp. Optional claims: custom attributes that match a user attribute definition (at most 50; others are dropped), segments (at most 50 manual segment slugs; it replaces the widget-sourced memberships, and a missing claim removes them). Identify also subscribes the person to the changelog when the workspace auto-subscribes.",
  action: "create",
  rateLimit: { limit: 60, windowSeconds: 15 * 60 },
  body: z.object({ ssoToken: z.string().min(1).max(8192) }),
  response: z.object({
    sessionToken: z.string(),
    principalId: z.string(),
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    }),
    canPortalHandoff: z.boolean(),
    /** The live posts the person voted on, newest first, at most 500. */
    votedPostIds: z.array(z.string()),
  }),
  responseDescription: "The widget session and the identified customer",
  errors: {
    403: "Widget disabled, identify not configured, invalid token or blocked person",
    409: "The email belongs to another customer",
  },
  allowKeys: ["sessionToken"],
  event: (_input, result) => ({
    type: "user.identified",
    entityType: "principal",
    entityId: result.principalId,
  }),
  handler: async ({ db, body }) => {
    const [config] = await db
      .select({
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings)
      .limit(1);
    if (parseJson(config?.widgetConfig ?? null).enabled !== true)
      throw new HTTPException(403, { message: "Widget is not enabled" });
    if (!config?.widgetSecret)
      throw new HTTPException(403, {
        message: "Widget identify is not configured",
      });
    const raw = verifyIdentityToken(body.ssoToken, config.widgetSecret);
    if (!raw)
      throw new HTTPException(403, { message: "Invalid or expired ssoToken" });
    const claims = claimsSchema.safeParse({
      sub: raw.sub ?? raw.id,
      email: raw.email,
      name: raw.name,
      avatarUrl: raw.avatarURL ?? raw.avatarUrl,
    });
    if (!claims.success)
      throw new HTTPException(403, {
        message: "The ssoToken needs a sub (or id) and a valid email claim",
      });
    const { sub, name, avatarUrl } = claims.data;
    const email = claims.data.email.toLowerCase();

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
      })
      .from(customer)
      .where(
        sql`${customer.externalId} = ${sub} OR lower(${customer.email}) = ${email}`,
      )
      // A NULL external ID must not sort before the sub match (DESC puts NULLs first).
      .orderBy(sql`(${customer.externalId} = ${sub}) desc nulls last`)
      .limit(1)
      .for("update");
    // A profile linked to a Kaneo account belongs to that account's portal sign-in.
    if (match?.kaneoUserId)
      throw new HTTPException(409, {
        message: "The email belongs to another customer",
      });
    if (match && match.email?.toLowerCase() !== email) {
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
    const [identity] = match
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
    const attributes = await claimedAttributes(db, raw);
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
    await reconcileClaimedSegments(db, person!.id, raw.segments);
    await autoSubscribeChangelog(db, person!.id);
    const session = await mintWidgetSession(
      db,
      { principalId: person!.id, customerId: identity!.id },
      config.widgetSecret,
    );
    return {
      sessionToken: session.token,
      principalId: person!.id,
      user: {
        id: identity!.id,
        name: identity!.name,
        email: identity!.email,
        avatarUrl: identity!.image,
      },
      // The widget-to-portal handoff is not built (decision D1 has no portal session for a visitor).
      canPortalHandoff: false,
      votedPostIds: await votedPostIds(db, person!.id),
    };
  },
});

export default apiRouter().openapi(...identify);
