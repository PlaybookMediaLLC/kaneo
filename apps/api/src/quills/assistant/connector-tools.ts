// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { eq } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../openapi";
import {
  CONNECTOR_TOOL_POLICIES,
  connectors,
  type CachedConnectorTool,
  type ConnectorToolPolicy,
} from "../../database/quills/schema/connectors";
import type { Database } from "../framework/define-route";

// The connector tools that the copilot may offer, shared by the worker and the approval route. A
// tool's name, description and input schema come from the remote server, so they are untrusted:
// the name is namespaced and bounded, the description is cut, and the schema becomes a copy whose
// checks cost work in proportion to its size before it validates the model's arguments.
// ROUTES.md, "Connector tools".

/** Built-in tool names never start with this prefix, so a connector tool cannot shadow one. */
export const CONNECTOR_PREFIX = "connector_";
const MAX_OFFERED = 32;
/** The characters of all offered descriptions and schemas in one run. */
const MAX_OFFERED_SIZE = 40_000;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 500;
const MAX_ARGS = 8_000;
const MAX_DEPTH = 32;
const MAX_NODES = 5_000;

/** The columns that decide which tools a connector offers. */
export const offerColumns = {
  id: connectors.id,
  name: connectors.name,
  slug: connectors.slug,
  enabled: connectors.enabled,
  status: connectors.status,
  assignments: connectors.assignments,
  tools: connectors.tools,
  toolPolicies: connectors.toolPolicies,
};
type ConnectorRow = Pick<
  typeof connectors.$inferSelect,
  keyof typeof offerColumns
>;

export type OfferedTool = {
  /** The name the model sees. */
  name: string;
  connectorId: string;
  connectorName: string;
  /** The server's own name of the tool. */
  tool: string;
  group: "read" | "write";
  policy: "always" | "approval";
  description: string;
  parameters: Record<string, unknown>;
  args: z.ZodType;
};

/** The arguments of a connector action: the connector, the server's tool name and the model's arguments. */
export const connectorCall = z.object({
  connectorId: flexibleToTypeIdSchema("connector"),
  tool: z.string().min(1).max(128),
  arguments: z.record(z.string(), z.unknown()),
});
type ConnectorCall = z.output<typeof connectorCall>;

export const isConnectorTool = (name: string) =>
  name.startsWith(CONNECTOR_PREFIX);

const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
/** A stable 8-character hash (djb2), so a changed name stays distinct. */
const hash = (value: string) => {
  let sum = 5381;
  for (let i = 0; i < value.length; i++)
    sum = ((sum << 5) + sum + value.charCodeAt(i)) | 0;
  return (sum >>> 0).toString(16).padStart(8, "0");
};

/** `connector_<slug>__<tool>`: at most 64 characters of [A-Za-z0-9_-], as model APIs accept. */
export function offeredName(slug: string, tool: string) {
  const prefix = `${CONNECTOR_PREFIX}${safe(slug).slice(0, 20)}__`;
  const room = MAX_NAME - prefix.length;
  return safe(tool) === tool && tool.length <= room
    ? prefix + tool
    : `${prefix}${safe(tool).slice(0, room - 9)}_${hash(tool)}`;
}

const known = (value: unknown): value is ConnectorToolPolicy =>
  (CONNECTOR_TOOL_POLICIES as readonly unknown[]).includes(value);

/** The tool's group and policy. Read only when the server says read-only and not destructive. */
export function policyOf(
  row: Pick<ConnectorRow, "toolPolicies">,
  tool: CachedConnectorTool,
) {
  const group =
    tool.annotations?.readOnlyHint === true &&
    tool.annotations?.destructiveHint !== true
      ? ("read" as const)
      : ("write" as const);
  const overrides = row.toolPolicies?.tools ?? {};
  // Own keys only: a tool named `constructor` must not read Object.prototype.
  const chosen = Object.hasOwn(overrides, tool.name)
    ? overrides[tool.name]
    : row.toolPolicies?.groupDefaults?.[group];
  const policy: ConnectorToolPolicy = known(chosen) ? chosen : "approval";
  return { group, policy };
}

/** Keywords whose values map names to schemas, and keywords whose values are data. */
const SCHEMA_MAPS = new Set(["properties", "dependentSchemas"]);
const DATA = new Set(["enum", "const", "default", "examples"]);
const DROPPED = new Set([
  "pattern",
  "patternProperties",
  "$defs",
  "definitions",
]);
const isMap = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The target of a local reference (`#` or `#/a/b`). Throws for any other reference. */
function target(root: unknown, ref: unknown) {
  if (typeof ref !== "string" || (ref !== "#" && !ref.startsWith("#/")))
    throw new Error("Only local references are allowed");
  return ref
    .split("/")
    .slice(1)
    .reduce<unknown>((node, part) => {
      const key = decodeURIComponent(part)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
      if (!isMap(node) || !Object.hasOwn(node, key))
        throw new Error("Unknown reference");
      return node[key];
    }, root);
}

/**
 * A copy of the schema whose checks cost work in proportion to its size. It has no `pattern` or
 * `patternProperties` (a server's regular expression must not block the worker), no repeated
 * `type` entries (each one converts the node again), and each local `$ref` replaced by a copy of
 * its target (a shared target is checked again for each use). Throws for a remote reference, more
 * than MAX_NODES nodes or more than MAX_DEPTH levels (also a reference cycle).
 */
function safeSchema(root: Record<string, unknown>) {
  let nodes = 0;
  const visit = (node: unknown, depth: number): unknown => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      throw new Error("The schema is too large");
    if (Array.isArray(node)) return node.map((item) => visit(item, depth + 1));
    if (!isMap(node)) return node;
    // ponytail: the target replaces the node, so keywords beside a $ref are dropped (looser check).
    if (Object.hasOwn(node, "$ref"))
      return visit(target(root, node.$ref), depth + 1);
    return Object.fromEntries(
      Object.entries(node).flatMap(([key, value]): [string, unknown][] => {
        if (DROPPED.has(key)) return [];
        if (DATA.has(key)) return [[key, value]];
        if (key === "type" && Array.isArray(value))
          return [[key, [...new Set(value)]]];
        if (SCHEMA_MAPS.has(key) && isMap(value))
          return [
            [
              key,
              Object.fromEntries(
                Object.entries(value).map(([name, schema]) => [
                  name,
                  visit(schema, depth + 1),
                ]),
              ),
            ],
          ];
        return [[key, visit(value, depth + 1)]];
      }),
    );
  };
  return visit(root, 0) as Record<string, unknown>;
}

/** The schema for the model and the validator of its arguments, or null when the schema cannot be used. */
export function inputOf(schema: Record<string, unknown> | undefined) {
  if (schema?.type !== "object") return null;
  try {
    const parameters = safeSchema(schema);
    // A registry of its own: an `id` in a server's schema must not stay in zod's global registry.
    const args = z.fromJSONSchema(parameters, { registry: z.registry() });
    return { parameters, args: args as z.ZodType };
  } catch {
    return null;
  }
}

/** The tool as the copilot offers it now, or null: `never`, a connector that is off, or no usable schema. */
function offer(
  row: ConnectorRow,
  tool: CachedConnectorTool,
): OfferedTool | null {
  if (
    !row.enabled ||
    row.status !== "connected" ||
    row.assignments?.copilot !== true
  )
    return null;
  const { group, policy } = policyOf(row, tool);
  if (policy === "never") return null;
  const input = inputOf(tool.inputSchema);
  if (!input) return null;
  const about = tool.description || tool.title || tool.name;
  return {
    name: offeredName(row.slug, tool.name),
    connectorId: row.id,
    connectorName: row.name,
    tool: tool.name,
    group,
    policy,
    description: `Connector "${row.name}": ${about.slice(0, MAX_DESCRIPTION)}`,
    ...input,
  };
}

/**
 * The tools of these connectors by offered name: at most MAX_OFFERED, with descriptions and schemas
 * of at most MAX_OFFERED_SIZE characters in all. A repeated name, or a tool that does not fit the
 * size that is left, is skipped.
 */
export function offeredTools(rows: ConnectorRow[]) {
  const offered = new Map<string, OfferedTool>();
  let size = 0;
  for (const row of rows)
    for (const tool of row.tools) {
      if (offered.size >= MAX_OFFERED) return offered;
      const one = offer(row, tool);
      const cost = one
        ? one.description.length + JSON.stringify(one.parameters).length
        : 0;
      if (!one || offered.has(one.name) || size + cost > MAX_OFFERED_SIZE)
        continue;
      size += cost;
      offered.set(one.name, one);
    }
  return offered;
}

/**
 * The model's arguments when they fit the tool: a JSON object of at most 8,000 characters with no
 * NUL or lone surrogate (jsonb refuses both), valid for the tool's schema. Null otherwise.
 */
export function checkArgs(tool: OfferedTool, args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const json = JSON.stringify(args);
  if (json.length > MAX_ARGS || /\\u(0000|d[89a-f])/i.test(json)) return null;
  try {
    return tool.args.safeParse(args).success
      ? (args as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The pending action's summary: the connector, the tool and all the arguments, so the approver sees what runs. */
export const summaryOf = (tool: OfferedTool, args: Record<string, unknown>) =>
  `Run ${tool.tool} on ${tool.connectorName} with ${JSON.stringify(args)}`;

/**
 * The tool of a stored connector action when it may still run: the connector is in this
 * workspace (the caller's scope), still offers the tool under the same name, and the arguments
 * fit its current schema. Null otherwise.
 */
export async function liveTool(
  db: Database,
  call: ConnectorCall,
  name: string,
) {
  const [row] = await db
    .select(offerColumns)
    .from(connectors)
    .where(eq(connectors.id, call.connectorId));
  const tool = row?.tools.find((one) => one.name === call.tool);
  const offered = row && tool ? offer(row, tool) : null;
  return offered?.name === name && checkArgs(offered, call.arguments)
    ? offered
    : null;
}
