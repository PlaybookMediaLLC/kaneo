import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  customDomains,
  verificationRecordName,
} from "../../database/quills/schema/custom-domains";
import { defineQuillsRoute } from "../framework/define-route";
import {
  hasWorkspaceEntitlement,
  requireWorkspaceEntitlement,
} from "../framework/platform-reads";

import { MAX_DOMAIN_LENGTH, normalizeDomain } from "./normalize-domain";

// Custom domains for the portal and the help center. A domain serves only after the DNS check
// (jobs/handlers/domain-check.ts) finds its TXT record. The global unique index on `domain`
// keeps one domain in one workspace.

type Row = typeof customDomains.$inferSelect;

const domainOut = z.object({
  kind: z.enum(["portal", "help_center"]),
  domain: z.string(),
  /** True once the TXT record was found. */
  active: z.boolean(),
  verifiedAt: z.string().nullable(),
  checkedAt: z.string().nullable(),
  checkResult: z.enum(["verified", "missing", "unanswered"]).nullable(),
  record: z.object({
    type: z.literal("TXT"),
    name: z.string(),
    value: z.string(),
  }),
});

const present = (row: Row): z.input<typeof domainOut> => ({
  kind: row.kind,
  domain: row.domain,
  active: row.verifiedAt !== null,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  checkedAt: row.checkedAt?.toISOString() ?? null,
  checkResult: row.checkResult ?? null,
  record: {
    type: "TXT",
    name: verificationRecordName(row.domain),
    value: row.verificationValue,
  },
});

/** The global unique index refused the domain: another workspace, or this workspace's other kind, holds it. */
const inUse = (error: unknown): never => {
  const failure = error as { code?: string; cause?: { code?: string } };
  if ((failure.cause?.code ?? failure.code) === "23505")
    throw new HTTPException(409, { message: "This domain is already in use" });
  throw error;
};

const entitlement = ({ workspaceId }: { workspaceId: string }) =>
  requireWorkspaceEntitlement(workspaceId);

const list = defineQuillsRoute({
  method: "get",
  path: "/operations/domains",
  operationId: "listQuillsCustomDomains",
  summary: "List the portal and help center custom domains",
  description:
    "A domain serves only when `active` is true. `entitled` is false when the workspace's Kaneo Cloud plan is not active.",
  action: "manage_settings",
  load: ({ workspaceId }) => hasWorkspaceEntitlement(workspaceId),
  response: z.object({ entitled: z.boolean(), domains: z.array(domainOut) }),
  responseDescription: "The custom domains",
  handler: async ({ db, loaded }) => ({
    entitled: loaded,
    domains: (
      await db.select().from(customDomains).orderBy(customDomains.kind)
    ).map(present),
  }),
});

function kindRoutes(
  kind: Row["kind"],
  title: string,
  segment: string,
  label: string,
) {
  const path = `/operations/domains/${segment}` as const;
  const set = defineQuillsRoute({
    method: "put",
    path,
    operationId: `setQuills${title}Domain`,
    summary: `Set the ${label} custom domain`,
    description:
      "A new domain starts inactive with a new TXT value. Sending the current domain again changes nothing. Returns 402 when the workspace's Kaneo Cloud plan is not active.",
    action: "manage_settings",
    body: z.object({
      domain: z
        .string()
        .min(1)
        .max(253)
        .refine(
          (value) => normalizeDomain(value) !== null,
          `Use a public host name of at most ${MAX_DOMAIN_LENGTH} characters, such as help.example.com`,
        ),
    }),
    load: entitlement,
    response: z.object({ changed: z.boolean(), domain: domainOut }),
    responseDescription: `The ${label} custom domain`,
    errors: { 409: "Another workspace or the other custom domain uses it" },
    event: (_input, result) =>
      result.changed && {
        type: "custom_domain.set",
        entityType: "custom_domain",
        entityId: result.domain.domain,
        payload: { kind },
      },
    handler: async ({ db, body }) => {
      const domain = normalizeDomain(body.domain)!;
      const [current] = await db
        .select()
        .from(customDomains)
        .where(eq(customDomains.kind, kind))
        .for("update");
      if (current?.domain === domain)
        return { changed: false, domain: present(current) };
      const values = {
        domain,
        verificationValue: crypto.randomUUID().replaceAll("-", ""),
        verifiedAt: null,
        checkedAt: null,
        checkResult: null,
      };
      const [row] = await db
        .insert(customDomains)
        .values({ kind, ...values })
        .onConflictDoUpdate({
          target: [customDomains.workspaceId, customDomains.kind],
          set: values,
        })
        .returning()
        .catch(inUse);
      return { changed: true, domain: present(row!) };
    },
  });
  const remove = defineQuillsRoute({
    method: "delete",
    path,
    operationId: `removeQuills${title}Domain`,
    summary: `Remove the ${label} custom domain`,
    description:
      "Always allowed, so a workspace without an active plan can still release its domain.",
    action: "manage_settings",
    response: z.object({ removed: z.boolean(), domain: z.string().nullable() }),
    responseDescription: "Whether a domain was removed",
    event: (_input, result) =>
      result.removed &&
      result.domain !== null && {
        type: "custom_domain.removed",
        entityType: "custom_domain",
        entityId: result.domain,
        payload: { kind },
      },
    handler: async ({ db }) => {
      const [row] = await db
        .delete(customDomains)
        .where(eq(customDomains.kind, kind))
        .returning({ domain: customDomains.domain });
      return { removed: Boolean(row), domain: row?.domain ?? null };
    },
  });
  const verify = defineQuillsRoute({
    method: "post",
    path: `${path}/verify`,
    operationId: `verifyQuills${title}Domain`,
    summary: `Check the ${label} custom domain's TXT record`,
    description:
      "Queues a DNS check of the stored domain; the list shows the result after the worker runs. Returns 402 when the workspace's Kaneo Cloud plan is not active.",
    action: "manage_settings",
    load: entitlement,
    response: domainOut,
    responseDescription: "The domain as stored before the check",
    errors: { 404: "No domain is set" },
    event: (_input, result) => ({
      type: "custom_domain.verification_requested",
      entityType: "custom_domain",
      entityId: result.domain,
      payload: { kind },
    }),
    handler: async ({ db }) => {
      const [row] = await db
        .select()
        .from(customDomains)
        .where(eq(customDomains.kind, kind));
      if (!row) throw new HTTPException(404, { message: "No domain is set" });
      return present(row);
    },
  });
  return apiRouter<BaseVariables & { workspaceId: string }>()
    .openapi(...set)
    .openapi(...remove)
    .openapi(...verify);
}

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...list)
  .route("/", kindRoutes("portal", "Portal", "portal", "portal"))
  .route(
    "/",
    kindRoutes("help_center", "HelpCenter", "help-center", "help center"),
  );
