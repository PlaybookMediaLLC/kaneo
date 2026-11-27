import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  brands,
  emailTemplates,
  type EmailTemplateBlock,
} from "../../database/quills/schema/brands";
import { emailSendingDomains } from "../../database/quills/schema/channel-accounts";
import { files } from "../../database/quills/schema/files";
import { rateBucket } from "../../database/quills/schema/kv";
import {
  renderBrandedEmailTemplate,
  sendBrandedTestEmail,
} from "../framework/brand-mail";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { imageUrl } from "../framework/files";

// Multi-brand settings and visual email template editor (#332).

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_BRANDS = 20;

async function assertOwnedLogoKey(
  db: Database,
  workspaceId: string,
  key: string | null | undefined,
) {
  if (!key) return;
  const trimmed = key.trim();
  if (trimmed.includes("..")) {
    throw new HTTPException(400, { message: "Invalid logo storage key" });
  }
  const [owned] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.storageKey, trimmed), isNull(files.deletedAt)))
    .limit(1);
  if (owned) return;
  if (trimmed.startsWith(`quills/${workspaceId}/`)) return;
  throw new HTTPException(400, {
    message: "Logo key must belong to this workspace",
  });
}

async function assertVerifiedFromEmail(
  db: Database,
  fromEmail: string | null | undefined,
) {
  if (!fromEmail) return;
  const domain = fromEmail.trim().toLowerCase().split("@")[1];
  if (!domain) {
    throw new HTTPException(400, { message: "Invalid sender email" });
  }
  const [verified] = await db
    .select({ id: emailSendingDomains.id })
    .from(emailSendingDomains)
    .where(
      and(
        eq(emailSendingDomains.domain, domain),
        isNotNull(emailSendingDomains.verifiedAt),
      ),
    )
    .limit(1);
  if (!verified) {
    throw new HTTPException(400, {
      message: "Sender email domain must be verified before use on a brand",
    });
  }
}

const brandParams = z.object({ brandId: flexibleToTypeIdSchema("brand") });

const blockSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["header", "text", "button", "divider", "footer"]),
  content: z.string().max(5000).optional(),
  label: z.string().max(120).optional(),
  url: z.string().max(2048).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});

const brandOut = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    isDefault: z.boolean(),
    primaryColor: z.string(),
    accentColor: z.string(),
    logoKey: z.string().nullable(),
    darkLogoKey: z.string().nullable(),
    fromName: z.string().nullable(),
    fromEmail: z.string().nullable(),
    replyTo: z.string().nullable(),
    footerText: z.string().nullable(),
    hidePoweredBy: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("QuillsBrand");

const templateOut = z
  .object({
    id: z.string(),
    brandId: z.string(),
    templateKey: z.string(),
    locale: z.string(),
    subject: z.string(),
    mode: z.enum(["blocks", "html"]),
    blocksJson: z.array(blockSchema),
    htmlBody: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi("QuillsEmailTemplate");

const presentBrand = (row: typeof brands.$inferSelect) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  isDefault: row.isDefault,
  primaryColor: row.primaryColor,
  accentColor: row.accentColor,
  logoKey: row.logoKey,
  darkLogoKey: row.darkLogoKey,
  fromName: row.fromName,
  fromEmail: row.fromEmail,
  replyTo: row.replyTo,
  footerText: row.footerText,
  hidePoweredBy: row.hidePoweredBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const presentTemplate = (row: typeof emailTemplates.$inferSelect) => ({
  id: row.id,
  brandId: row.brandId,
  templateKey: row.templateKey,
  locale: row.locale,
  subject: row.subject,
  mode: row.mode,
  blocksJson: (row.blocksJson ?? []) as EmailTemplateBlock[],
  htmlBody: row.htmlBody,
  updatedAt: row.updatedAt.toISOString(),
});

const errors = { 403: "Insufficient permission", 404: "Brand not found" };

const listBrands = defineQuillsRoute({
  method: "get",
  path: "/settings/brands",
  operationId: "listQuillsBrands",
  summary: "List workspace email brands (#332)",
  action: "read",
  response: z.object({ brands: z.array(brandOut) }),
  responseDescription: "Workspace brands",
  handler: async ({ db }) => ({
    brands: (
      await db
        .select()
        .from(brands)
        .orderBy(asc(brands.createdAt))
        .limit(MAX_BRANDS)
    ).map(presentBrand),
  }),
});

const createBrand = defineQuillsRoute({
  method: "post",
  path: "/settings/brands",
  operationId: "createQuillsBrand",
  summary: "Create a workspace brand for multi-brand email templates (#332)",
  action: "manage_settings",
  body: z.object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().toLowerCase().regex(SLUG, "Invalid brand slug"),
    isDefault: z.boolean().default(false),
    primaryColor: z.string().regex(HEX_COLOR).default("#4f46e5"),
    accentColor: z.string().regex(HEX_COLOR).default("#111827"),
    logoKey: z.string().max(500).nullable().optional(),
    darkLogoKey: z.string().max(500).nullable().optional(),
    fromName: z.string().trim().max(120).nullable().optional(),
    fromEmail: z.email().max(320).nullable().optional(),
    replyTo: z.email().max(320).nullable().optional(),
    footerText: z.string().trim().max(500).nullable().optional(),
    hidePoweredBy: z.boolean().default(false),
  }),
  response: z.object({ brand: brandOut }),
  responseDescription: "The created brand",
  errors: { ...errors, 409: "Brand slug already exists or limit reached" },
  event: (_input, result) => ({
    type: "brand.created",
    entityType: "brand",
    entityId: result.brand.id,
  }),
  handler: async ({ db, workspaceId, body }) => {
    await assertOwnedLogoKey(db, workspaceId, body.logoKey);
    await assertOwnedLogoKey(db, workspaceId, body.darkLogoKey);
    await assertVerifiedFromEmail(db, body.fromEmail);
    const existing = await db.select({ id: brands.id }).from(brands);
    if (existing.length >= MAX_BRANDS) {
      throw new HTTPException(409, {
        message: `A workspace can have at most ${MAX_BRANDS} brands`,
      });
    }
    if (body.isDefault) {
      await db.update(brands).set({ isDefault: false });
    }
    const [row] = await db
      .insert(brands)
      .values({
        name: body.name,
        slug: body.slug,
        isDefault: body.isDefault || existing.length === 0,
        primaryColor: body.primaryColor,
        accentColor: body.accentColor,
        logoKey: body.logoKey ?? null,
        darkLogoKey: body.darkLogoKey ?? null,
        fromName: body.fromName ?? null,
        fromEmail: body.fromEmail ?? null,
        replyTo: body.replyTo ?? null,
        footerText: body.footerText ?? null,
        hidePoweredBy: body.hidePoweredBy,
      })
      .returning()
      .catch((err) => {
        const pgErr = err as {
          code?: string;
          constraint?: string;
          cause?: { code?: string; constraint?: string };
        };
        if ((pgErr.cause?.code ?? pgErr.code) === "23505") {
          const constraint = pgErr.cause?.constraint ?? pgErr.constraint;
          throw new HTTPException(409, {
            message:
              constraint === "brands_workspace_default_idx"
                ? "Another default brand was saved concurrently. Please retry."
                : "Brand slug already exists",
          });
        }
        throw err;
      });
    return { brand: presentBrand(row!) };
  },
});

const updateBrand = defineQuillsRoute({
  method: "patch",
  path: "/settings/brands/{brandId}",
  operationId: "updateQuillsBrand",
  summary: "Update a workspace brand (#332)",
  action: "manage_settings",
  params: brandParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      isDefault: z.boolean().optional(),
      primaryColor: z.string().regex(HEX_COLOR).optional(),
      accentColor: z.string().regex(HEX_COLOR).optional(),
      logoKey: z.string().max(500).nullable().optional(),
      darkLogoKey: z.string().max(500).nullable().optional(),
      fromName: z.string().trim().max(120).nullable().optional(),
      fromEmail: z.email().max(320).nullable().optional(),
      replyTo: z.email().max(320).nullable().optional(),
      footerText: z.string().trim().max(500).nullable().optional(),
      hidePoweredBy: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, "Nothing to update"),
  response: z.object({ brand: brandOut }),
  responseDescription: "The updated brand",
  errors,
  event: ({ params }) => ({
    type: "brand.updated",
    entityType: "brand",
    entityId: params.brandId,
  }),
  handler: async ({ db, workspaceId, params, body }) => {
    await assertOwnedLogoKey(db, workspaceId, body.logoKey);
    await assertOwnedLogoKey(db, workspaceId, body.darkLogoKey);
    await assertVerifiedFromEmail(db, body.fromEmail);
    if (body.isDefault) {
      await db.update(brands).set({ isDefault: false });
    }
    const [row] = await db
      .update(brands)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        ...(body.primaryColor !== undefined && {
          primaryColor: body.primaryColor,
        }),
        ...(body.accentColor !== undefined && {
          accentColor: body.accentColor,
        }),
        ...(body.logoKey !== undefined && { logoKey: body.logoKey }),
        ...(body.darkLogoKey !== undefined && {
          darkLogoKey: body.darkLogoKey,
        }),
        ...(body.fromName !== undefined && { fromName: body.fromName }),
        ...(body.fromEmail !== undefined && { fromEmail: body.fromEmail }),
        ...(body.replyTo !== undefined && { replyTo: body.replyTo }),
        ...(body.footerText !== undefined && { footerText: body.footerText }),
        ...(body.hidePoweredBy !== undefined && {
          hidePoweredBy: body.hidePoweredBy,
        }),
        updatedAt: new Date(),
      })
      .where(eq(brands.id, params.brandId))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Brand not found" });
    return { brand: presentBrand(row) };
  },
});

const deleteBrand = defineQuillsRoute({
  method: "delete",
  path: "/settings/brands/{brandId}",
  operationId: "deleteQuillsBrand",
  summary: "Delete a workspace brand (#332)",
  action: "manage_settings",
  params: brandParams,
  response: z.object({ deleted: z.boolean() }),
  responseDescription: "Brand deleted",
  errors,
  event: ({ params }) => ({
    type: "brand.deleted",
    entityType: "brand",
    entityId: params.brandId,
  }),
  handler: async ({ db, params }) => {
    const rows = await db
      .delete(brands)
      .where(eq(brands.id, params.brandId))
      .returning({ id: brands.id });
    if (!rows.length)
      throw new HTTPException(404, { message: "Brand not found" });
    return { deleted: true };
  },
});

const listTemplates = defineQuillsRoute({
  method: "get",
  path: "/settings/brands/{brandId}/email-templates",
  operationId: "listQuillsEmailTemplates",
  summary: "List email templates configured for a brand (#332)",
  action: "manage_settings",
  params: brandParams,
  response: z.object({ templates: z.array(templateOut) }),
  responseDescription: "Brand email templates",
  errors,
  handler: async ({ db, params }) => {
    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, params.brandId));
    if (!brand) throw new HTTPException(404, { message: "Brand not found" });
    const rows = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.brandId, params.brandId))
      .orderBy(asc(emailTemplates.templateKey), asc(emailTemplates.locale));
    return { templates: rows.map(presentTemplate) };
  },
});

const upsertTemplate = defineQuillsRoute({
  method: "put",
  path: "/settings/brands/{brandId}/email-templates/{templateKey}",
  operationId: "upsertQuillsEmailTemplate",
  summary: "Create or update a visual/HTML email template for a brand (#332)",
  action: "manage_settings",
  params: brandParams.extend({
    templateKey: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9._-]+$/),
  }),
  body: z.object({
    locale: z.string().min(2).max(16).default("en"),
    subject: z.string().trim().min(1).max(500),
    mode: z.enum(["blocks", "html"]).default("blocks"),
    blocksJson: z.array(blockSchema).max(40).default([]),
    htmlBody: z.string().max(100_000).nullable().optional(),
  }),
  response: z.object({ template: templateOut }),
  responseDescription: "The saved email template",
  errors,
  event: (_input, result) => ({
    type: "email_template.updated",
    entityType: "email_template",
    entityId: result.template.id,
  }),
  handler: async ({ db, params, body }) => {
    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, params.brandId));
    if (!brand) throw new HTTPException(404, { message: "Brand not found" });
    const now = new Date();
    const [row] = await db
      .insert(emailTemplates)
      .values({
        brandId: params.brandId,
        templateKey: params.templateKey,
        locale: body.locale,
        subject: body.subject,
        mode: body.mode,
        blocksJson: body.blocksJson,
        htmlBody: body.htmlBody ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          emailTemplates.workspaceId,
          emailTemplates.brandId,
          emailTemplates.templateKey,
          emailTemplates.locale,
        ],
        set: {
          subject: body.subject,
          mode: body.mode,
          blocksJson: body.blocksJson,
          htmlBody: body.htmlBody ?? null,
          updatedAt: now,
        },
      })
      .returning();
    return { template: presentTemplate(row!) };
  },
});

const renderInputSchema = z.object({
  brandId: flexibleToTypeIdSchema("brand").optional(),
  brand: z
    .object({
      name: z.string().min(1).max(120),
      primaryColor: z.string().regex(HEX_COLOR).optional(),
      accentColor: z.string().regex(HEX_COLOR).optional(),
      logoUrl: z.string().max(2048).nullable().optional(),
      darkLogoUrl: z.string().max(2048).nullable().optional(),
      footerText: z.string().max(500).nullable().optional(),
      hidePoweredBy: z.boolean().optional(),
    })
    .optional(),
  subject: z.string().trim().min(1).max(500),
  mode: z.enum(["blocks", "html"]).default("blocks"),
  blocksJson: z.array(blockSchema).max(40).default([]),
  htmlBody: z.string().max(100_000).nullable().optional(),
  variables: z.record(z.string(), z.string().max(1000)).default({}),
});

const previewTemplate = defineQuillsRoute({
  method: "post",
  path: "/settings/email-templates/preview",
  operationId: "previewQuillsEmailTemplate",
  summary: "Render a live branded email template preview (#332)",
  description:
    "Uses the exact same renderer as outbound branded emails so preview HTML matches sent HTML byte-for-byte.",
  action: "manage_settings",
  body: renderInputSchema,
  response: z.object({
    subject: z.string(),
    html: z.string(),
    text: z.string(),
  }),
  responseDescription: "Rendered email subject, HTML, and plain text",
  errors,
  event: { none: "Read-only template preview; writes nothing." },
  handler: async ({ db, body }) => {
    let brandStyle = body.brand ?? { name: "Support" };
    if (body.brandId) {
      const [row] = await db
        .select()
        .from(brands)
        .where(eq(brands.id, body.brandId));
      if (!row) throw new HTTPException(404, { message: "Brand not found" });
      brandStyle = {
        name: row.name,
        primaryColor: row.primaryColor,
        accentColor: row.accentColor,
        logoUrl: row.logoKey ? await imageUrl(row.logoKey) : null,
        darkLogoUrl: row.darkLogoKey ? await imageUrl(row.darkLogoKey) : null,
        footerText: row.footerText,
        hidePoweredBy: row.hidePoweredBy,
      };
    }
    return renderBrandedEmailTemplate({
      brand: brandStyle,
      subject: body.subject,
      mode: body.mode,
      blocks: body.blocksJson,
      htmlBody: body.htmlBody,
      variables: body.variables,
    });
  },
});

const sendTestEmail = defineQuillsRoute({
  method: "post",
  path: "/settings/email-templates/send-test",
  operationId: "sendQuillsTestEmail",
  summary: "Send a rate-limited test email using a brand template (#332)",
  description:
    "Rate-limited to 10 sends per hour per workspace. Renders with the exact same renderer as preview and sends outside the database transaction.",
  action: "manage_settings",
  body: renderInputSchema.extend({
    to: z.email().max(320),
  }),
  prepare: async ({ db, body }) => {
    let brandStyle = body.brand ?? { name: "Support" };
    let fromEmail: string | null = null;
    let replyTo: string | null = null;
    let fromDisplayName: string | null = null;
    if (body.brandId) {
      const [row] = await db
        .select()
        .from(brands)
        .where(eq(brands.id, body.brandId));
      if (!row) throw new HTTPException(404, { message: "Brand not found" });
      brandStyle = {
        name: row.name,
        primaryColor: row.primaryColor,
        accentColor: row.accentColor,
        logoUrl: row.logoKey ? await imageUrl(row.logoKey) : null,
        darkLogoUrl: row.darkLogoKey ? await imageUrl(row.darkLogoKey) : null,
        footerText: row.footerText,
        hidePoweredBy: row.hidePoweredBy,
      };
      fromEmail = row.fromEmail;
      replyTo = row.replyTo;
      fromDisplayName = row.fromName ?? row.name;
    }
    // Atomically reserve a rate-limit slot before dispatching outbound email (closes TOCTOU race).
    const [bucket] = await db
      .insert(rateBucket)
      .values({
        workspaceKey: "_",
        key: "email-template:send-test",
        count: 1,
        windowExpiresAt: sql`now() + interval '1 hour'`,
      })
      .onConflictDoUpdate({
        target: [
          rateBucket.workspaceId,
          rateBucket.workspaceKey,
          rateBucket.key,
        ],
        set: {
          count: sql`CASE WHEN ${rateBucket.windowExpiresAt} <= now() THEN 1 ELSE ${rateBucket.count} + 1 END`,
          windowExpiresAt: sql`CASE WHEN ${rateBucket.windowExpiresAt} <= now() THEN excluded.window_expires_at ELSE ${rateBucket.windowExpiresAt} END`,
        },
      })
      .returning({ count: rateBucket.count });
    if ((bucket?.count ?? 0) > 10) {
      throw new HTTPException(429, {
        message: "Test email limit reached (10 per hour). Try again later.",
      });
    }
    const rendered = renderBrandedEmailTemplate({
      brand: brandStyle,
      subject: body.subject,
      mode: body.mode,
      blocks: body.blocksJson,
      htmlBody: body.htmlBody,
      variables: body.variables,
    });
    return { to: body.to, fromEmail, replyTo, fromDisplayName, rendered };
  },
  call: async (prepared) => ({
    rendered: prepared.rendered,
    result: await sendBrandedTestEmail(prepared),
  }),
  response: z.object({
    sent: z.boolean(),
    reason: z.string().optional(),
    subject: z.string(),
    html: z.string(),
  }),
  responseDescription: "Test email dispatch outcome and exact rendered HTML",
  errors: { ...errors, 429: "Rate limit exceeded (10/hour)" },
  event: { none: "Test email send; rate-limit budget reserved in prepare." },
  handler: async ({ called }) => ({
    sent: called.result.sent,
    ...(called.result.reason ? { reason: called.result.reason } : {}),
    subject: called.rendered.subject,
    html: called.rendered.html,
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listBrands)
  .openapi(...createBrand)
  .openapi(...updateBrand)
  .openapi(...deleteBrand)
  .openapi(...listTemplates)
  .openapi(...upsertTemplate)
  .openapi(...previewTemplate)
  .openapi(...sendTestEmail);
