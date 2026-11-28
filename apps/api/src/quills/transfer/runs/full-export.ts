import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import { settings } from "../../../database/quills/schema/auth";
import {
  exportRuns,
  exportSchedules,
} from "../../../database/quills/schema/export-runs";
import { defineQuillsRoute } from "../../framework/define-route";
import {
  credentialText,
  sealCredentials,
  validateWebhookUrl,
} from "../../framework/integration-config";
import { exportWorkspaceZipBundle } from "../zip-bundle";

const CADENCES = ["daily", "weekly", "monthly"] as const;

function computeNextRunAt(
  cadence: (typeof CADENCES)[number],
  from = new Date(),
) {
  const days = cadence === "daily" ? 1 : cadence === "weekly" ? 7 : 30;
  return new Date(from.getTime() + days * 86_400_000);
}

const scheduleViewSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  cadence: z.enum(CADENCES),
  destinationEndpoint: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  region: z.string(),
  hasCredentials: z.boolean(),
  lastRunAt: nullableResponseTimestamp,
  nextRunAt: nullableResponseTimestamp,
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: responseTimestamp,
});

const fullExportZip = defineQuillsRoute({
  method: "post",
  path: "/transfer/full-export",
  operationId: "exportQuillsWorkspaceZip",
  summary:
    "Export the full workspace as a portable .zip archive (NDJSON + Markdown KB + manifest)",
  description:
    "Builds a standard PKZIP archive containing manifest.json, data/<table>.ndjson for every portable table (redacting secrets and omitting scheduled backup credentials), and articles/<slug>.md for live KB articles. Requires an interactive session plus manage_settings and view_revenue.",
  action: "manage_settings",
  alsoRequires: ["view_revenue"],
  sessionOnly: true,
  body: z.object({
    format: z.literal("zip"),
    since: z.iso.datetime({ offset: true }).max(64).optional(),
  }),
  response: z.object({
    runId: z.string(),
    fileName: z.string(),
    sizeBytes: z.number(),
    manifest: z.object({
      format: z.literal("kaneo-workspace-zip"),
      version: z.literal(1),
      exportedAt: z.string(),
      since: z.string().nullable(),
      tables: z.array(
        z.object({
          table: z.string(),
          count: z.number(),
        }),
      ),
      markdownArticleCount: z.number(),
      fileCount: z.number(),
    }),
    zipBase64: z.string(),
  }),
  responseDescription: "Portable workspace .zip archive and manifest",
  event: (_input, result) => ({
    type: "export.finished",
    entityType: "export_run",
    entityId: result.runId,
    payload: { format: "zip", sizeBytes: String(result.sizeBytes) },
  }),
  handler: async ({ db, actor, body }) => {
    const [workspace] = await db
      .select({ slug: settings.slug })
      .from(settings)
      .limit(1);
    const slug = workspace?.slug ?? actor.workspaceId;
    const sinceDate = body.since ? new Date(body.since) : null;
    let bundle: Awaited<ReturnType<typeof exportWorkspaceZipBundle>>;
    try {
      bundle = await exportWorkspaceZipBundle(db, actor.workspaceId, {
        since: sinceDate,
      });
    } catch (err) {
      if (err instanceof Error && /exceeds/i.test(err.message)) {
        throw new HTTPException(413, { message: err.message });
      }
      throw err;
    }
    const { zip, manifest } = bundle;
    const fileName = `kaneo-export-${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
    const now = new Date();
    const [run] = await db
      .insert(exportRuns)
      .values({
        status: "completed",
        format: "zip",
        since: sinceDate,
        fileName,
        sizeBytes: zip.byteLength,
        fileCount: manifest.fileCount + manifest.markdownArticleCount,
        entityCounts: manifest.tableCounts,
        manifestJson: manifest as unknown as Record<string, unknown>,
        initiatedByPrincipalId: actor.principalId,
        finishedAt: now,
      })
      .returning({ id: exportRuns.id });

    return {
      runId: run!.id,
      fileName,
      sizeBytes: zip.byteLength,
      manifest: {
        format: manifest.format,
        version: manifest.version,
        exportedAt: manifest.exportedAt,
        since: manifest.since,
        tables: Object.entries(manifest.tableCounts).map(([table, count]) => ({
          table,
          count,
        })),
        markdownArticleCount: manifest.markdownArticleCount,
        fileCount: manifest.fileCount,
      },
      zipBase64: zip.toString("base64"),
    };
  },
});

const getSchedule = defineQuillsRoute({
  method: "get",
  path: "/transfer/export-schedule",
  operationId: "getQuillsExportSchedule",
  summary: "Get the workspace's scheduled S3/R2 backup configuration",
  action: "manage_settings",
  response: z.object({ schedule: scheduleViewSchema.nullable() }),
  responseDescription: "Current backup schedule or null",
  handler: async ({ db }) => {
    const [row] = await db.select().from(exportSchedules).limit(1);
    if (!row) return { schedule: null };
    return {
      schedule: {
        id: row.id,
        enabled: row.enabled,
        cadence: row.cadence,
        destinationEndpoint: row.destinationEndpoint,
        bucket: row.bucket,
        prefix: row.prefix,
        region: row.region,
        hasCredentials: row.sealedCredentials.length > 0,
        lastRunAt: row.lastRunAt,
        nextRunAt: row.nextRunAt,
        lastStatus: row.lastStatus,
        lastError: row.lastError,
        updatedAt: row.updatedAt,
      },
    };
  },
});

const setSchedule = defineQuillsRoute({
  method: "put",
  path: "/transfer/export-schedule",
  operationId: "setQuillsExportSchedule",
  summary: "Configure scheduled S3/R2 workspace exports",
  description:
    "Validates the S3/R2 destination URL against HTTPS and SSRF rules (blocks loopback/private/metadata IPs) and encrypts credentials via NOTIFICATION_SECRET_ENCRYPTION_KEY. Credentials are never returned.",
  action: "manage_settings",
  sessionOnly: true,
  body: z.object({
    enabled: z.boolean().default(true),
    cadence: z.enum(CADENCES).default("weekly"),
    destinationEndpoint: z.url().max(300),
    bucket: z.string().trim().min(1).max(120),
    prefix: z.string().trim().max(200).default("kaneo-backups/"),
    region: z.string().trim().min(1).max(60).default("auto"),
    accessKey: z.string().min(4).max(200).regex(credentialText),
    secretAccessKey: z.string().min(8).max(400).regex(credentialText),
  }),
  response: z.object({ schedule: scheduleViewSchema }),
  responseDescription: "Saved backup schedule (without plaintext credentials)",
  errors: {
    400: "Invalid or disallowed S3/R2 destination endpoint",
    409: "Set NOTIFICATION_SECRET_ENCRYPTION_KEY to store scheduled backup credentials",
  },
  event: (_input, result) => ({
    type: "export_schedule.updated",
    entityType: "export_schedule",
    entityId: result.schedule.id,
    payload: {
      cadence: result.schedule.cadence,
      enabled: String(result.schedule.enabled),
    },
  }),
  handler: async ({ db, body }) => {
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(body.destinationEndpoint);
    } catch {
      throw new HTTPException(400, { message: "Invalid destination endpoint" });
    }
    if (
      parsedEndpoint.protocol !== "https:" ||
      parsedEndpoint.username ||
      parsedEndpoint.password ||
      parsedEndpoint.search ||
      parsedEndpoint.hash
    ) {
      throw new HTTPException(400, {
        message: "Destination endpoint must be a clean https:// URL",
      });
    }
    try {
      await validateWebhookUrl(body.destinationEndpoint);
    } catch {
      throw new HTTPException(400, {
        message: "Destination endpoint is not allowed (SSRF protection)",
      });
    }
    const sealed = sealCredentials({
      accessKeyId: body.accessKey,
      secretAccessKey: body.secretAccessKey,
    });
    const now = new Date();
    const nextRunAt = body.enabled ? computeNextRunAt(body.cadence, now) : null;
    const [saved] = await db
      .insert(exportSchedules)
      .values({
        enabled: body.enabled,
        cadence: body.cadence,
        destinationEndpoint: body.destinationEndpoint,
        bucket: body.bucket,
        prefix: body.prefix,
        region: body.region,
        sealedCredentials: sealed,
        nextRunAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: exportSchedules.workspaceId,
        set: {
          enabled: body.enabled,
          cadence: body.cadence,
          destinationEndpoint: body.destinationEndpoint,
          bucket: body.bucket,
          prefix: body.prefix,
          region: body.region,
          sealedCredentials: sealed,
          nextRunAt,
          updatedAt: now,
        },
      })
      .returning();

    return {
      schedule: {
        id: saved!.id,
        enabled: saved!.enabled,
        cadence: saved!.cadence,
        destinationEndpoint: saved!.destinationEndpoint,
        bucket: saved!.bucket,
        prefix: saved!.prefix,
        region: saved!.region,
        hasCredentials: true,
        lastRunAt: saved!.lastRunAt,
        nextRunAt: saved!.nextRunAt,
        lastStatus: saved!.lastStatus,
        lastError: saved!.lastError,
        updatedAt: saved!.updatedAt,
      },
    };
  },
});

const deleteSchedule = defineQuillsRoute({
  method: "delete",
  path: "/transfer/export-schedule",
  operationId: "deleteQuillsExportSchedule",
  summary: "Delete the workspace's scheduled S3/R2 export configuration",
  action: "manage_settings",
  response: z.object({ deleted: z.boolean() }),
  responseDescription: "Whether a schedule was removed",
  event: (_input, result) =>
    result.deleted && {
      type: "export_schedule.deleted",
      entityType: "export_schedule",
      entityId: "default",
    },
  handler: async ({ db }) => {
    const removed = await db
      .delete(exportSchedules)
      .returning({ id: exportSchedules.id });
    return { deleted: removed.length > 0 };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...fullExportZip)
  .openapi(...getSchedule)
  .openapi(...setSchedule)
  .openapi(...deleteSchedule);
