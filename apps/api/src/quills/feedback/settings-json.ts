// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { settings } from "../../database/quills/schema/auth";
import type { AnyQuillsRoute } from "../framework/define-route";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];
// Text columns that hold a JSON object. Kaneo owns settings.name and settings.slug; these helpers never write them.
type Column = "metadata" | "portalConfig";

/** The stored JSON object, `{}` when empty, or null when the text is not a JSON object. */
export function parseBag(text: string | null): Record<string, unknown> | null {
  if (!text?.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One key of a settings JSON column. A malformed column reads as unset. */
export async function readSettingsKey(db: Db, column: Column, key: string) {
  const [row] = await db.select({ text: settings[column] }).from(settings);
  return parseBag(row?.text ?? null)?.[key];
}

/** Replaces one key and keeps every other key as stored. The row lock serializes writers of other keys. */
export async function writeSettingsKey<T>(
  db: Db,
  column: Column,
  key: string,
  next: (stored: unknown) => T,
): Promise<T> {
  const [row] = await db
    .select({ id: settings.id, text: settings[column] })
    .from(settings)
    .for("update");
  if (!row) throw new Error("Quills workspace was not initialized");
  const bag = parseBag(row.text);
  if (!bag)
    throw new HTTPException(409, {
      message:
        "Stored settings are not a JSON object; they were left unchanged",
    });
  const value = next(bag[key]);
  const text = JSON.stringify({ ...bag, [key]: value });
  await db
    .update(settings)
    .set(column === "metadata" ? { metadata: text } : { portalConfig: text })
    .where(eq(settings.id, row.id));
  return value;
}
