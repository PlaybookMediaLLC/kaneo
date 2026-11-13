// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
// Settings receipts (decision D11): the before and after values of the allowlisted fields that one
// settings write changed. A key is a text column ("customCss") or a top-level key of a JSON text
// column ("portalConfig.features"). A JSON key that is absent has no entry in the record, so undo
// removes it again and the stored JSON is the same as before the write.
import type { settings } from "../../database/quills/schema/auth";

type Row = typeof settings.$inferSelect;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
/** Stored settings are JSON text, so every value read from them is JSON. */
export type ReceiptValues = Record<string, Json>;
export type Receipt = {
  area: string;
  before: ReceiptValues;
  after: ReceiptValues;
};

/** events.ts RECEIPT_MAX_BYTES; a route module cannot import events.ts (receipts.test.ts checks both). */
export const RECEIPT_LIMIT_BYTES = 128 * 1024;
/** jsonb refuses a NUL character and a lone surrogate, which a JSON text column can still hold. */
const UNSTORABLE = /\\u0000|\\ud[89a-f]/i;

const JSON_COLUMNS = new Set([
  "portalConfig",
  "widgetConfig",
  "developerConfig",
  "featureFlags",
]);
const isRecord = (value: unknown): value is Record<string, Json> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const parse = (text: unknown) => {
  try {
    const value: unknown = JSON.parse(typeof text === "string" ? text : "{}");
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
};
const split = (key: string) => {
  const [column, field, ...rest] = key.split(".") as [keyof Row, string?];
  if (rest.length || JSON_COLUMNS.has(column) !== (field !== undefined))
    throw new Error(`Not a settings receipt key: ${key}`);
  return { column, field };
};

/** The stored value at a key: a text column's text, or a JSON key's value (undefined when absent). */
export function receiptValue(row: Row, key: string): Json | undefined {
  const { column, field } = split(key);
  return field === undefined
    ? (row[column] as Json)
    : parse(row[column])[field];
}

/** Equal JSON values; object key order does not count (jsonb reorders keys). */
export const sameValue = (a: unknown, b: unknown) => {
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, item: unknown) =>
      isRecord(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([x], [y]) => (x < y ? -1 : 1)),
          )
        : item,
    );
  return canonical(a) === canonical(b);
};

/**
 * The allowlisted values that a write changed; null when it changed none, or when its audit row
 * cannot hold them (over the size limit, or a value that jsonb refuses). The change still saves; it
 * only cannot be undone.
 */
export function receiptOf(
  area: string,
  keys: readonly string[],
  before: Row,
  after: Row,
): Receipt | null {
  const receipt: Receipt = { area, before: {}, after: {} };
  for (const key of keys) {
    const was = receiptValue(before, key);
    const is = receiptValue(after, key);
    if (sameValue(was, is)) continue;
    if (was !== undefined) receipt.before[key] = was;
    if (is !== undefined) receipt.after[key] = is;
  }
  if (!(Object.keys(receipt.before).length + Object.keys(receipt.after).length))
    return null;
  const text = JSON.stringify(receipt);
  return Buffer.byteLength(text) <= RECEIPT_LIMIT_BYTES &&
    !UNSTORABLE.test(text)
    ? receipt
    : null;
}

/** The column values that put `values` back at `keys`. A text column takes only a string or null. */
export function restoredColumns(
  row: Row,
  keys: readonly string[],
  values: ReceiptValues,
) {
  const columns: Record<string, unknown> = {};
  for (const key of keys) {
    const { column, field } = split(key);
    const value = values[key];
    if (field === undefined) {
      if (value !== null && typeof value !== "string")
        throw new Error(`Not a text value for ${key}`);
      columns[column] = value;
      continue;
    }
    const json = (columns[column] ??= parse(row[column])) as Record<
      string,
      Json
    >;
    if (Object.hasOwn(values, key)) json[field] = value!;
    else delete json[field];
  }
  for (const column of JSON_COLUMNS)
    if (column in columns) columns[column] = JSON.stringify(columns[column]);
  return columns as Partial<typeof settings.$inferInsert>;
}
