// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { HTTPException } from "hono/http-exception";
import { z } from "../../openapi";
import type { ticketTypes } from "../../database/quills/schema/ticket-types";

type Field = (typeof ticketTypes.$inferSelect)["fields"][number];
export type AttributeValue = string | number | boolean | null;

const TEXT_MAX = 4000;
export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "select",
  "date",
  "checkbox",
] as const;

/** One intake-form field, as the source's ticket form schema checks it. */
export const fieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[a-z0-9_]+$/,
        "Key must be lowercase letters, digits, and underscores",
      ),
    label: z.string().trim().min(1).max(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    visibleToCustomer: z.boolean(),
    order: z.number().int().min(-100000).max(100000),
    options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  })
  .refine((f) => f.type !== "select" || (f.options?.length ?? 0) > 0, {
    message: "A select field must define at least one option",
    path: ["options"],
  });
export const fieldsSchema = z
  .array(fieldSchema)
  .max(50)
  .refine(
    (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
    "Each field key can appear only once",
  );

/** Free-form attributes for a ticket with no registry type. */
export const attributesInput = z
  .record(
    z.string().min(1).max(64),
    z.union([z.string().max(TEXT_MAX), z.number(), z.boolean(), z.null()]),
  )
  .refine((value) => Object.keys(value).length <= 50, "At most 50 attributes");

function isIsoDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d));
  const real =
    day.getUTCFullYear() === y &&
    day.getUTCMonth() === m! - 1 &&
    day.getUTCDate() === d;
  const iso =
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(
      value,
    ) &&
      !Number.isNaN(Date.parse(value)));
  return iso && real;
}

/**
 * Checks answers against a type's form (every field, customer-hidden included, as the teammate form
 * shows them) and returns only the form's keys, coerced to each field's type. Unknown keys are dropped.
 */
export function validateFieldValues(
  form: Field[],
  values: Record<string, AttributeValue>,
): Record<string, string | number | boolean> {
  const errors: string[] = [];
  const cleaned: Record<string, string | number | boolean> = {};
  for (const field of form) {
    const raw = values[field.key];
    const missing =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && !raw.trim());
    if (missing && field.type !== "checkbox") {
      if (field.required) errors.push(`${field.label} is required`);
      continue;
    }
    const text = typeof raw === "string" ? raw : String(raw ?? "");
    switch (field.type) {
      case "text":
      case "long_text":
        if (text.length > TEXT_MAX)
          errors.push(`${field.label} must be ${TEXT_MAX} characters or less`);
        else cleaned[field.key] = text;
        break;
      case "number": {
        const n =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Number(raw)
              : Number.NaN;
        if (Number.isFinite(n)) cleaned[field.key] = n;
        else errors.push(`${field.label} must be a number`);
        break;
      }
      case "select":
        if ((field.options ?? []).includes(text)) cleaned[field.key] = text;
        else errors.push(`${field.label} is not a valid option`);
        break;
      case "date":
        if (typeof raw === "string" && isIsoDate(raw)) cleaned[field.key] = raw;
        else errors.push(`${field.label} must be a valid date`);
        break;
      case "checkbox": {
        const checked = raw === true || raw === "true";
        if (field.required && !checked)
          errors.push(`${field.label} is required`);
        else cleaned[field.key] = checked;
        break;
      }
    }
  }
  if (errors.length)
    throw new HTTPException(400, { message: errors.join("; ") });
  return cleaned;
}
