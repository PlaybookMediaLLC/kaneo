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
// the name is namespaced and bounded, the description is cut, and the schema loses its regular
// expressions before it validates the model's arguments. ROUTES.md, "Connector tools".

/** Built-in tool names never start with this prefix, so a connector tool cannot shadow one. */
export const CONNECTOR_PREFIX = "connector_";
export const MAX_OFFERED = 32;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 500;
const MAX_ARGS = 8_000;
const MAX_DEPTH = 32;

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
type ConnectorRow = {
  [K in keyof typeof offerColumns]: (typeof offerColumns)[K]["_"]["data"];
};

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
export type ConnectorCall = z.output<typeof connectorCall>;

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
const SCHEMA_MAPS = new Set([
  "properties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
const DATA = new Set(["enum", "const", "default", "examples"]);
/**
 * The schema without `pattern` and `patternProperties`: a server's regular expression must not
 * block the worker on the model's arguments. Throws when the schema is nested too deeply.
 */
function withoutPatterns(node: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new Error("The schema is nested too deeply");
  if (Array.isArray(node))
    return node.map((item) => withoutPatterns(item, depth + 1));
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]): [string, unknown][] => {
      if (key === "pattern" || key === "patternProperties") return [];
      if (DATA.has(key)) return [[key, value]];
      if (
        SCHEMA_MAPS.has(key) &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      )
        return [
          [
            key,
            Object.fromEntries(
              Object.entries(value).map(([name, schema]) => [
                name,
                withoutPatterns(schema, depth + 1),
              ]),
            ),
          ],
        ];
      return [[key, withoutPatterns(value, depth + 1)]];
    }),
  );
}

/** The schema for the model and the validator of its arguments, or null when the schema cannot be used. */
export function inputOf(schema: Record<string, unknown> | undefined) {
  if (schema?.type !== "object") return null;
  try {
    const parameters = withoutPatterns(schema, 0) as Record<string, unknown>;
    return { parameters, args: z.fromJSONSchema(parameters) as z.ZodType };
  } catch {
    return null;
  }
}

/** The tool as the copilot offers it now, or null: `never`, a connector that is off, or no usable schema. */
export function offer(
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

/** The tools of these connectors, at most MAX_OFFERED, by offered name. A repeated name is skipped. */
export function offeredTools(rows: ConnectorRow[]) {
  const offered = new Map<string, OfferedTool>();
  for (const row of rows)
    for (const tool of row.tools) {
      if (offered.size >= MAX_OFFERED) return offered;
      const one = offer(row, tool);
      if (one && !offered.has(one.name)) offered.set(one.name, one);
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

/** The pending action's summary: the connector, the tool and at most 300 characters of the arguments. */
export function summaryOf(tool: OfferedTool, args: Record<string, unknown>) {
  const json = JSON.stringify(args);
  return `Run ${tool.tool} on ${tool.connectorName} with ${json.length > 300 ? `${json.slice(0, 300)}…` : json}`;
}

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
