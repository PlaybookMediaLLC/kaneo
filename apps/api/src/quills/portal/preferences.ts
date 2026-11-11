import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { requirePortalAccess, requirePortalEnabled } from "./gate";

// The signed-in customer's language preference and the portal @-mention typeahead.

/** A loose BCP-47 tag, as the source checks it: "en", "pt-BR", "zh-Hans-CN". */
const language = z
  .string()
  .regex(
    /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/,
    "A BCP-47 tag, like en or pt-BR",
  )
  .max(35)
  .nullable();

const getLanguage = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/user/language",
  operationId: "getQuillsMyLanguagePreference",
  summary: "Get the caller's language preference",
  description:
    "Null until set. A teammate's language is the account locale, not this value.",
  action: "read",
  response: z.object({ language }),
  responseDescription: "The caller's language preference",
  handler: async ({ db, caller }) => {
    await requirePortalEnabled(db);
    const [row] = caller.customerId
      ? await db
          .select({ language: customer.preferredLanguage })
          .from(customer)
          .where(eq(customer.id, caller.customerId))
      : [];
    return { language: row?.language ?? null };
  },
});

const setLanguage = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/user/language",
  operationId: "setQuillsMyLanguagePreference",
  summary: "Set or clear the caller's language preference",
  action: "update",
  rateLimit: { limit: 30, windowSeconds: 600 },
  body: z.object({ language }),
  response: z.object({ language }),
  responseDescription: "The caller's language preference",
  event: { none: "The caller's own preference; no shared record changes." },
  handler: async ({ db, caller, body }) => {
    await requirePortalEnabled(db);
    await db
      .update(customer)
      .set({ preferredLanguage: body.language })
      .where(eq(customer.id, caller.customerId!));
    return { language: body.language };
  },
});

const httpUrl = (value: string | null) =>
  value && /^https?:\/\//i.test(value) ? value : null;

const mentions = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/mentions/suggest",
  operationId: "listQuillsPortalMentionSuggestions",
  summary: "Suggest people to @-mention",
  description:
    "Up to 10 people whose display name starts with q (an empty q lists the first 10). Never matches or returns an email address. scope team lists teammates only. The caller needs a customer profile.",
  action: "read",
  rateLimit: { limit: 60, windowSeconds: 60 },
  query: z.object({
    q: z.string().trim().max(100).default(""),
    scope: z.enum(["all", "team"]).default("all"),
  }),
  response: z.object({
    people: z.array(
      z.object({
        principalId: z.string(),
        displayName: z.string(),
        avatarUrl: z.string().nullable(),
        team: z.boolean(),
      }),
    ),
  }),
  responseDescription: "Matching people",
  errors: { 403: "Portal access denied or no customer profile" },
  handler: async ({ db, caller, query }) => {
    await requirePortalAccess(db, caller);
    if (!caller.principalId)
      throw new HTTPException(403, {
        message: "Create your profile before you mention people",
      });
    const prefix = query.q.toLowerCase().replace(/[\\%_]/g, "\\$&");
    const rows = await db
      .select({
        principalId: principal.id,
        displayName: principal.displayName,
        avatarUrl: principal.avatarUrl,
        kaneoUserId: principal.kaneoUserId,
      })
      .from(principal)
      .where(
        and(
          eq(principal.type, "user"),
          isNotNull(principal.displayName),
          isNull(principal.blockedAt),
          isNull(principal.testOwnerPrincipalId),
          // Never the caller, whether as this customer or as a teammate of the same account.
          ne(principal.id, caller.principalId),
          or(
            isNull(principal.kaneoUserId),
            ne(principal.kaneoUserId, caller.account!.id),
          ),
          query.scope === "team"
            ? isNotNull(principal.kaneoUserId)
            : or(isNotNull(principal.kaneoUserId), isNotNull(principal.userId)),
          ...(prefix
            ? [sql`lower(${principal.displayName}) like ${`${prefix}%`}`]
            : []),
        ),
      )
      .orderBy(asc(sql`lower(${principal.displayName})`), asc(principal.id))
      .limit(10);
    return {
      people: rows.map((row) => ({
        principalId: row.principalId,
        displayName: row.displayName!,
        avatarUrl: httpUrl(row.avatarUrl),
        team: row.kaneoUserId !== null,
      })),
    };
  },
});

export default apiRouter()
  .openapi(...getLanguage)
  .openapi(...setLanguage)
  .openapi(...mentions);
