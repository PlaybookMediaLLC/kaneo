import { eq, sql } from "drizzle-orm";
import { apiRouter, z } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { defineQuillsRoute } from "../framework/define-route";
import { replayHorizon, segmentIdentify } from "../framework/signed";
import { coerce, mergeMetadata } from "../directory/customer";

// POST /quills-public/signed/integrations/segment/{integrationId}/identify: Segment identify calls.
// framework/signed.ts checks the signature with the connection's shared secret; the workspace is the
// integration's. As in the source, a call updates only an existing customer found by email: each
// trait that a user attribute definition names (its external key, else its key) is coerced to the
// definition's type and merged into the customer's metadata. Other traits, unknown emails and
// teammates change nothing.
// ponytail: the delivery receipt and the replay horizon stop repeats; an identify call that Segment
// delivers late can still replace a newer value. Order by `timestamp` if CDPs reorder in practice.

const trait = z
  .union([z.string().max(10_000), z.number(), z.boolean(), z.null()])
  // Nested objects and arrays are not attributes: they read as absent.
  .catch(null);
const traits = z
  .record(z.string().max(200), trait)
  .refine((value) => Object.keys(value).length <= 500, "At most 500 traits");

const receive = defineQuillsRoute({
  audience: "signed",
  verifier: segmentIdentify,
  method: "post",
  path: "/integrations/{type}/{integrationId}/identify",
  operationId: "receiveQuillsIdentify",
  summary: "Receive a Segment identify call",
  description:
    "Segment signs the body (x-signature: base64 HMAC-SHA1). Only existing customers change, and only attributes that a user attribute definition names. A repeated call changes nothing.",
  action: "update",
  params: z.object({
    type: z.enum(["segment"]),
    integrationId: z.string().regex(/^integration_[0-9a-z]{26}$/),
  }),
  body: z.object({
    type: z.string().max(64),
    timestamp: z.string().max(64).optional(),
    userId: z.string().max(255).nullable().optional(),
    traits: traits.optional(),
    context: z.object({ traits: traits.optional() }).optional(),
  }),
  response: z.object({
    status: z.enum(["updated", "unchanged", "unknown", "ignored"]),
    principalId: z.string().nullable(),
  }),
  responseDescription: "Whether a customer changed",
  replay: { status: "ignored", principalId: null },
  event: (_input, result) =>
    result.status === "updated" &&
    result.principalId !== null && {
      type: "user.identified",
      entityType: "principal",
      entityId: result.principalId,
      payload: { source: "segment" },
    },
  handler: async ({ db, body }) => {
    const answer = (
      status: "unchanged" | "unknown" | "ignored",
      principalId: string | null = null,
    ) => ({ status, principalId });
    if (body.type !== "identify") return answer("ignored");
    const at = body.timestamp ? new Date(body.timestamp) : null;
    if (at && at < replayHorizon()) return answer("ignored");
    // Top-level traits win over context traits, as in the source.
    const values = Object.assign({}, body.context?.traits, body.traits);
    const email =
      typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
    if (!email || email.length > 254) return answer("ignored");
    const [match] = await db
      .select({
        id: user.id,
        kaneoUserId: user.kaneoUserId,
        metadata: user.metadata,
        principalId: principal.id,
      })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(sql`lower(${user.email}) = ${email}`)
      .limit(1)
      .for("update");
    // A teammate's account is Kaneo's: a customer data platform never edits it.
    if (!match || match.kaneoUserId) return answer("unknown");
    const definitions = await db
      .select({
        key: userAttributeDefinitions.key,
        externalKey: userAttributeDefinitions.externalKey,
        type: userAttributeDefinitions.type,
      })
      .from(userAttributeDefinitions)
      .limit(500);
    const set: Record<string, string | number | boolean> = {};
    for (const definition of definitions) {
      const value = values[definition.externalKey ?? definition.key];
      if (value === null || value === undefined) continue;
      const coerced = coerce(value, definition.type);
      if (coerced !== undefined) set[definition.key] = coerced;
    }
    if (body.userId) set._externalUserId = body.userId;
    const metadata = mergeMetadata(match.metadata, { set, remove: [] });
    if (!Object.keys(set).length || metadata === match.metadata)
      return answer("unchanged", match.principalId);
    await db.update(user).set({ metadata }).where(eq(user.id, match.id));
    return { status: "updated" as const, principalId: match.principalId };
  },
});

export default apiRouter().openapi(...receive);
