// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { actionInput, ATTRIBUTE, LIST_OPS, type WorkflowAction } from "./model";

// The pure condition evaluator and graph walker. No database access: the engine and the
// preview pass in a snapshot (model.ts loadContext) and run the actions it returns.

export type ConditionContext = {
  conversation: {
    status: string;
    channel: string;
    priority: string;
    tagIds: string[];
    teamId: string | null;
    attributes: Record<string, unknown>;
  };
  message: { body: string; sender: string } | null;
};

/** Unknown fields resolve to undefined, which only `is_empty` matches. */
function resolve(field: string, ctx: ConditionContext): unknown {
  if (field.startsWith(ATTRIBUTE)) {
    const raw = ctx.conversation.attributes[field.slice(ATTRIBUTE.length)];
    // Stored values are `{ v, src, at }` envelopes or bare legacy values.
    return raw !== null && typeof raw === "object" && "v" in raw
      ? (raw as { v: unknown }).v
      : raw;
  }
  switch (field) {
    case "conversation.status":
      return ctx.conversation.status;
    case "conversation.channel":
      return ctx.conversation.channel;
    case "conversation.priority":
      return ctx.conversation.priority;
    case "conversation.tags":
      return ctx.conversation.tagIds;
    case "conversation.team":
      return ctx.conversation.teamId;
    case "message.body":
      return ctx.message?.body ?? null;
    case "message.sender":
      return ctx.message?.sender ?? null;
    default:
      return undefined;
  }
}

const blank = (v: unknown) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0);
const list = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v === undefined ? [] : [v];
const number = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? Number.NaN : Number(v);
/** A number and a numeric string compare as numbers; other types compare strictly. */
const same = (a: unknown, b: unknown) =>
  (typeof a === "number" && typeof b === "string") ||
  (typeof a === "string" && typeof b === "number")
    ? number(a) === number(b)
    : a === b;

/**
 * As in the source: an unresolved subject (null or undefined) matches only `is_empty`, so a
 * typo in a field never makes a negative operator match. Type mismatches are non-matches.
 */
function apply(actual: unknown, op: unknown, value: unknown) {
  const missing = actual === null || actual === undefined;
  switch (op) {
    case "eq":
      return !missing && same(actual, value);
    case "neq":
      return !missing && !same(actual, value);
    case "contains":
    case "not_contains": {
      if (typeof value !== "string") return false;
      const hit =
        typeof actual === "string" &&
        actual.toLowerCase().includes(value.toLowerCase());
      return op === "contains" ? hit : !missing && !hit;
    }
    case "contains_any":
    case "contains_all": {
      if (typeof actual !== "string") return false;
      const words = list(value).filter(
        (w): w is string => typeof w === "string" && w.trim() !== "",
      );
      if (!words.length) return false;
      const text = actual.toLowerCase();
      const hits = words.filter((w) => text.includes(w.toLowerCase()));
      return op === "contains_any"
        ? hits.length > 0
        : hits.length === words.length;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = number(actual),
        b = number(value);
      if (missing || Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === "gt"
        ? a > b
        : op === "gte"
          ? a >= b
          : op === "lt"
            ? a < b
            : a <= b;
    }
    case "includes_any":
    case "excludes_all": {
      const values = list(value);
      if (!values.length) return false;
      const any = values.some((v) => list(actual).includes(v));
      return op === "includes_any" ? any : !missing && !any;
    }
    case "is_set":
      return !blank(actual);
    case "is_empty":
      return blank(actual);
    default:
      return false;
  }
}

/**
 * Every `all` child holds and, when `any` has children, one of them does. A list operator
 * reads `values` (or a single `value`); every other operator reads `value` only, and one
 * that needs a value and has none never matches. Malformed stored input never matches.
 */
export function evaluate(condition: unknown, ctx: ConditionContext): boolean {
  if (!condition || typeof condition !== "object") return false;
  const c = condition as Record<string, unknown>;
  if (typeof c.field === "string") {
    const value = LIST_OPS.has(c.op as string)
      ? (c.values ?? c.value)
      : c.value;
    if (value === undefined && c.op !== "is_set" && c.op !== "is_empty")
      return false;
    return apply(resolve(c.field, ctx), c.op, value);
  }
  const { all = [], any = [] } = c;
  if (!Array.isArray(all) || !Array.isArray(any)) return false;
  if (!all.every((child) => evaluate(child, ctx))) return false;
  return !any.length || any.some((child) => evaluate(child, ctx));
}

export type Walk = {
  actions: WorkflowAction[];
  /** completed: reached the end; halted: a condition, a branch or an unknown step stopped it. */
  status: "completed" | "halted";
};

type Step = Record<string, unknown>;
const steps = (value: unknown): Step[] =>
  Array.isArray(value)
    ? value.filter((item): item is Step => !!item && typeof item === "object")
    : [];

/**
 * Walks a stored graph from its trigger and returns the actions to run, in order. Conditions
 * read one snapshot taken before any action runs. Defensive: a missing edge ends the path, a
 * revisited step ends it, an unknown step or an action that no longer validates halts it.
 */
export function walk(raw: unknown, ctx: ConditionContext): Walk {
  const graph = (raw && typeof raw === "object" ? raw : {}) as Step;
  const nodes = steps(graph.nodes);
  const edges = steps(graph.edges);
  const next = (from: unknown, branch?: string) => {
    const edge = edges.find((e) => e.from === from && e.branch === branch);
    return edge && nodes.find((n) => n.id === edge.to);
  };
  const actions: WorkflowAction[] = [];
  const seen = new Set<unknown>();
  let n = nodes.find((node) => node.type === "trigger");
  while (n && !seen.has(n.id)) {
    seen.add(n.id);
    if (n.type === "action") {
      const action = actionInput.safeParse(n.action);
      if (!action.success) return { actions, status: "halted" };
      actions.push(action.data);
    } else if (n.type === "condition") {
      if (!evaluate(n.condition, ctx)) return { actions, status: "halted" };
    } else if (n.type === "branch") {
      const match = steps(n.branches).find((b) => evaluate(b.condition, ctx));
      if (typeof match?.key !== "string") return { actions, status: "halted" };
      n = next(n.id, match.key);
      continue;
    } else if (n.type !== "trigger") return { actions, status: "halted" };
    n = next(n.id);
  }
  return { actions, status: "completed" };
}
