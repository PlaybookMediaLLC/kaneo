import { z } from "../../openapi";
import { buildQuillsRoute, type AnyQuillsRoute } from "./define-route";

// The static contract check `bounded-inputs`: every string, array and page size that a route
// accepts in its path, query or body has a maximum.

/** Longer than any declared maximum. A string input must reject each probe. */
const LONG = 100_001;
const LONG_MAP = 10_001;
const probes = [
  "a".repeat(LONG),
  "1".repeat(LONG),
  `${"a".repeat(LONG)}@example.com`,
  `https://example.com/${"a".repeat(LONG)}`,
  // An ISO datetime without a precision accepts any number of fractional-second digits.
  `2024-01-01T00:00:00.${"1".repeat(LONG)}Z`,
];

type Def = { type: string } & Record<string, any>;
const def = (schema: z.ZodType) => schema._zod.def as Def;
/** A declared maximum check: `.max()` on an array or a number. An integer's safe range is not one. */
const hasMax = (schema: z.ZodType) =>
  (def(schema).checks ?? []).some((check: z.ZodType) =>
    ["max_length", "less_than"].includes(def(check).check),
  );
/** The input type that a chain of pipes starts from. */
const source = (schema: z.ZodType): z.ZodType =>
  def(schema).type === "pipe" ? source(def(schema).in) : schema;

/**
 * Paths in an input schema that accept a value with no maximum. A string input (a string, or a
 * pipe from one, such as a TypeID or a paging number) is bounded when it rejects an over-long
 * value, and a record when it rejects too many entries; an array needs a declared maximum;
 * a `limit` page size needs a maximum value.
 */
export function unbounded(schema: z.ZodType, path: string): string[] {
  const d = def(schema);
  switch (d.type) {
    case "optional":
    case "nullable":
    case "default":
    case "catch":
      return unbounded(d.innerType, path);
    case "object":
      return [
        ...Object.entries(d.shape as Record<string, z.ZodType>).flatMap(
          ([key, value]) => unbounded(value, `${path}.${key}`),
        ),
        // A loose object or a catchall accepts other keys too.
        ...(d.catchall && def(d.catchall).type !== "never"
          ? unbounded(d.catchall, `${path}.*`)
          : []),
      ];
    case "union":
      return (d.options as z.ZodType[]).flatMap((option) =>
        unbounded(option, path),
      );
    case "array":
      return [
        ...(hasMax(schema) ? [] : [`${path} has no maximum length`]),
        ...unbounded(d.element, `${path}[]`),
      ];
    case "pipe":
      // A preprocess step accepts anything; its target schema decides.
      if (def(d.in).type === "transform") return unbounded(d.out, path);
      if (def(source(schema)).type !== "string") return unbounded(d.in, path);
    // falls through: a pipe from a string is probed as a whole.
    case "string":
      return probes.some((probe) => schema.safeParse(probe).success)
        ? [`${path} accepts a string of ${LONG} characters`]
        : [];
    case "record": {
      // Probed like a string: it must reject a map of LONG_MAP entries, each with an accepted value.
      const value = [null, "", 0, false].find(
        (candidate) => d.valueType.safeParse(candidate).success,
      );
      const many = Object.fromEntries(
        Array.from({ length: LONG_MAP }, (_, i) => [`k${i}`, value]),
      );
      return [
        ...(value !== undefined && !schema.safeParse(many).success
          ? []
          : [`${path} accepts ${LONG_MAP} entries`]),
        ...unbounded(d.keyType, `${path}{key}`),
        ...unbounded(d.valueType, `${path}{}`),
      ];
    }
    case "number":
      return path.endsWith(".limit") && !hasMax(schema)
        ? [`${path} has no maximum`]
        : [];
    case "enum":
    case "literal":
    case "boolean":
    case "date":
    case "null":
    case "undefined":
      return [];
    default:
      // set, map, intersection, any, unknown, custom, lazy and types this check does not know yet.
      return [`${path} (${d.type}) has no maximum`];
  }
}

/** The bounded-inputs findings of one declaration: the served path, query and body schemas. */
export function boundedInputIssues(d: AnyQuillsRoute): string[] {
  const { request } = buildQuillsRoute(d)[0] as unknown as {
    request: {
      params: z.ZodType;
      query?: z.ZodType;
      body?: { content: { "application/json": { schema: z.ZodType } } };
    };
  };
  // A signed route parses its body from the verified raw bytes, so the served route declares none.
  const body = request.body?.content["application/json"].schema ?? d.body;
  return [
    ...(request.params ? unbounded(request.params, "params") : []),
    ...(request.query ? unbounded(request.query, "query") : []),
    ...(body ? unbounded(body, "body") : []),
  ];
}
