import { and, eq, inArray, isNull } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { segments } from "../../database/quills/schema/segments";
import { defineQuillsRoute } from "../framework/define-route";
import { parseJson, record } from "../settings/area";

// Teammate writer for the private-portal policy that evaluateQuillsMyPortalAccess reads.

/** Lowercase, strip a leading "@", drop entries that are not a bare domain. */
function normalizeDomains(raw: string[]) {
  const domains = new Set<string>();
  for (const entry of raw) {
    const domain = entry.trim().toLowerCase().replace(/^@/, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) domains.add(domain);
  }
  return [...domains];
}

const access = z.object({
  visibility: z.enum(["public", "private"]),
  allowedDomains: z.array(z.string()),
  allowedSegmentIds: z.array(z.string()),
});

const updateAccess = defineQuillsRoute({
  method: "put",
  path: "/settings/portal/access",
  operationId: "updateQuillsPortalAccess",
  summary: "Update who may open a private portal",
  description:
    "Fields that are not sent keep their value. Unknown or deleted segments are dropped. A workspace member always has access.",
  action: "manage_settings",
  body: z.object({
    visibility: z.enum(["public", "private"]),
    allowedDomains: z.array(z.string().max(253)).max(100).optional(),
    allowedSegmentIds: z
      .array(flexibleToTypeIdSchema("segment"))
      .max(100)
      .optional(),
  }),
  response: access,
  responseDescription: "The portal access policy",
  event: ({ workspaceId }, result) => ({
    type: "settings.portal_access_updated",
    entityType: "settings",
    entityId: workspaceId,
    payload: { visibility: result.visibility },
  }),
  handler: async ({ db, body }) => {
    const [row] = await db
      .select({ id: settings.id, portalConfig: settings.portalConfig })
      .from(settings)
      .limit(1)
      .for("update");
    if (!row) throw new Error("Quills settings were not initialized");
    const config = parseJson(row.portalConfig);
    const before = record(config.access);
    const strings = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
    const requested = [...new Set(body.allowedSegmentIds ?? [])];
    const next = {
      ...before,
      visibility: body.visibility,
      allowedDomains: body.allowedDomains
        ? normalizeDomains(body.allowedDomains)
        : strings(before.allowedDomains),
      allowedSegmentIds: body.allowedSegmentIds
        ? requested.length
          ? (
              await db
                .select({ id: segments.id })
                .from(segments)
                .where(
                  and(
                    inArray(segments.id, requested),
                    isNull(segments.deletedAt),
                  ),
                )
            ).map((segment) => segment.id as string)
          : []
        : strings(before.allowedSegmentIds),
    };
    await db
      .update(settings)
      .set({ portalConfig: JSON.stringify({ ...config, access: next }) })
      .where(eq(settings.id, row.id));
    return {
      visibility: next.visibility,
      allowedDomains: next.allowedDomains,
      allowedSegmentIds: next.allowedSegmentIds,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...updateAccess,
);
