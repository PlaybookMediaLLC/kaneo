import { readFile } from "node:fs/promises";

export async function readOpenApi(root) {
  return JSON.parse(await readFile(`${root}/apps/docs/openapi.json`, "utf8"));
}

export function findOperation(document, operationId) {
  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.operationId === operationId)
        return { path, method, operation };
    }
  }
  throw new Error(`Unknown OpenAPI operation: ${operationId}`);
}

export function endpointExpression(path, method) {
  return `client${path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^\{(.+)\}$/, ":$1"))
    .map((segment) => `[${JSON.stringify(segment)}]`)
    .join("")}.$${method}`;
}

export function resolveSchema(document, schema) {
  if (!schema?.$ref) return schema ?? {};
  return schema.$ref
    .replace(/^#\//, "")
    .split("/")
    .reduce((value, key) => value[key], document);
}

export function zodForSchema(document, rawSchema) {
  const schema = resolveSchema(document, rawSchema);
  if (schema.allOf)
    return schema.allOf
      .map((part) => zodForSchema(document, part))
      .reduce((left, right) => `z.intersection(${left}, ${right})`);
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives)
    return `z.union([${alternatives.map((part) => zodForSchema(document, part)).join(", ")}])`;
  if (schema.enum) {
    if (schema.enum.every((value) => typeof value === "string"))
      return `z.enum(${JSON.stringify(schema.enum)})`;
    const values = schema.enum.map(
      (value) => `z.literal(${JSON.stringify(value)})`,
    );
    return values.length === 1 ? values[0] : `z.union([${values.join(", ")}])`;
  }
  if (Array.isArray(schema.type)) {
    const variants = schema.type.map((type) =>
      zodForSchema(document, { ...schema, type }),
    );
    return variants.length === 1
      ? variants[0]
      : `z.union([${variants.join(", ")}])`;
  }
  if (schema.type === "null") return "z.null()";
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties ?? {}).map(
      ([name, value]) => {
        const expression = zodForSchema(document, value);
        return `${JSON.stringify(name)}: ${required.has(name) ? expression : `${expression}.optional()`}`;
      },
    );
    return `z.object({ ${fields.join(", ")} })`;
  }
  if (schema.type === "array")
    return `z.array(${zodForSchema(document, schema.items)})${schema.minItems ? `.min(${schema.minItems})` : ""}${schema.maxItems ? `.max(${schema.maxItems})` : ""}`;
  if (schema.type === "integer" || schema.type === "number")
    return `z.number()${schema.minimum !== undefined ? `.min(${schema.minimum})` : ""}${schema.maximum !== undefined ? `.max(${schema.maximum})` : ""}`;
  if (schema.type === "boolean") return "z.boolean()";
  return `z.string()${schema.format === "email" ? ".email()" : ""}${schema.minLength !== undefined ? `.min(${schema.minLength})` : ""}${schema.maxLength !== undefined ? `.max(${schema.maxLength})` : ""}`;
}

export function defaultForSchema(document, rawSchema, name = "value") {
  const schema = resolveSchema(document, rawSchema);
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.allOf)
    return Object.assign(
      {},
      ...schema.allOf.map((part) => defaultForSchema(document, part, name)),
    );
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives) return defaultForSchema(document, alternatives[0], name);
  if (Array.isArray(schema.type)) {
    if (schema.type.includes("null")) return null;
    return defaultForSchema(
      document,
      { ...schema, type: schema.type[0] },
      name,
    );
  }
  if (schema.type === "null") return null;
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? []);
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([key]) => required.has(key))
        .map(([key, value]) => [key, defaultForSchema(document, value, key)]),
    );
  }
  if (schema.type === "array") return [];
  if (schema.type === "integer" || schema.type === "number")
    return schema.minimum ?? 0;
  if (schema.type === "boolean") return false;
  if (schema.format === "email") return "person@example.test";
  if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z";
  if (name.toLowerCase().endsWith("id"))
    return `${name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}_test_1`;
  if (name.toLowerCase().includes("token")) return "mail_link_value";
  return "value";
}
