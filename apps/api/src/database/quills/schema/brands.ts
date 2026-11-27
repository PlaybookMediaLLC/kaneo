import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeIdColumn, typeIdWithDefault } from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";

export interface EmailTemplateBlock {
  id: string;
  type: "header" | "text" | "button" | "divider" | "footer";
  content?: string;
  label?: string;
  url?: string;
  align?: "left" | "center" | "right";
}

/**
 * Workspace brands for multi-brand email sending & visual templates (#332).
 * Portable table: logo_key and dark_logo_key are tracked in storage_references
 * and transfer/archive.ts#STORAGE_FIELDS.
 */
export const brands = quillsSchema
  .table(
    "brands",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("brand")("id").notNull(),
      name: text("name").notNull(),
      slug: text("slug").notNull(),
      isDefault: boolean("is_default").notNull().default(false),
      primaryColor: text("primary_color").notNull().default("#4f46e5"),
      accentColor: text("accent_color").notNull().default("#111827"),
      logoKey: text("logo_key"),
      darkLogoKey: text("dark_logo_key"),
      fromName: text("from_name"),
      fromEmail: text("from_email"),
      replyTo: text("reply_to"),
      footerText: text("footer_text"),
      hidePoweredBy: boolean("hide_powered_by").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("brands_workspace_slug_idx").on(
        table.workspaceId,
        table.slug,
      ),
      uniqueIndex("brands_workspace_default_idx")
        .on(table.workspaceId)
        .where(sql`${table.isDefault} = true`),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Custom per-brand email templates (#332): supports structured visual blocks OR
 * sanitized raw HTML escape hatch, keyed by (brand, templateKey, locale).
 */
export const emailTemplates = quillsSchema
  .table(
    "email_templates",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("email_template")("id").notNull(),
      brandId: typeIdColumn("brand")("brand_id").notNull(),
      templateKey: text("template_key").notNull(),
      locale: text("locale").notNull().default("en"),
      subject: text("subject").notNull(),
      mode: text("mode", { enum: ["blocks", "html"] })
        .notNull()
        .default("blocks"),
      blocksJson: jsonb("blocks_json")
        .$type<EmailTemplateBlock[]>()
        .notNull()
        .default([]),
      htmlBody: text("html_body"),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      foreignKey({
        name: "email_templates_brand_id_fkey",
        columns: [table.workspaceId, table.brandId],
        foreignColumns: [brands.workspaceId, brands.id],
      }).onDelete("cascade"),
      index("email_templates_brand_id_idx").on(table.brandId),
      uniqueIndex("email_templates_brand_key_locale_idx").on(
        table.workspaceId,
        table.brandId,
        table.templateKey,
        table.locale,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
