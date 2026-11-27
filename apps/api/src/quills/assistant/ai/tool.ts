// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import type { ActionPreviewDiff } from "../../../database/quills/schema/assistant-pending-actions";
import type { z } from "../../../openapi";
import type { Database, QuillsActor } from "../../framework/define-route";
import type { Conversation } from "../../support/conversation-model";

// The tool template. A tool is tied to the workspace (it reads and writes only through the scoped
// database it gets), to the asking teammate (the model sees it only while that teammate holds its
// action), to the agent that offers it, and to its eval (assistant_tool_calls records each call).

/** Safe AI action limits (#300). */
export const ACTION_TTL_MS = 15 * 60 * 1000;
export const MAX_PROPOSED_CHANGES_PER_MESSAGE = 20;
export const MAX_BULK_RECORDS = 50;

/**
 * Tool policy vocabulary (#300):
 * - `lookup`: read-only lookup tool allowed
 * - `ask` (legacy alias `propose`): write tool creates a pending action for human approval
 * - `auto_write`: admin-opted-in automatic write execution
 * - `disabled` (legacy alias `off`): tool is not offered and denied in code
 */
export const TOOL_POLICY_MODES = [
  "lookup",
  "ask",
  "auto_write",
  "disabled",
  "propose",
  "off",
] as const;
export type ToolPolicyMode = (typeof TOOL_POLICY_MODES)[number];
export type EffectiveToolPolicy = "lookup" | "ask" | "auto_write" | "disabled";

/** Normalizes legacy mode names (`propose` -> `ask`, `off` -> `disabled`). */
export function normalizeToolPolicy(
  mode: string | undefined,
): EffectiveToolPolicy | null {
  if (mode === "lookup") return "lookup";
  if (mode === "ask" || mode === "propose") return "ask";
  if (mode === "auto_write") return "auto_write";
  if (mode === "disabled" || mode === "off") return "disabled";
  return null;
}

/**
 * Resolves the effective policy for one tool under workspace rules + procedure allowlists.
 * Safety invariants (#300):
 * - Read tools default to `lookup` unless explicitly `disabled`.
 * - Write tools default to `ask` (never silent `auto_write` unless explicitly configured).
 * - When multiple policies conflict, the more restrictive policy wins: `disabled` > `ask` > `auto_write`.
 * - If any active procedure declares a non-empty `allowedTools` list, any write tool outside
 *   the union of active procedures' `allowedTools` is `disabled` in code.
 */
export function resolveToolPolicy(
  tool: Pick<AiTool, "name" | "kind">,
  configuredModes: readonly (string | undefined)[],
  procedureAllowedTools?: ReadonlySet<string> | null,
): EffectiveToolPolicy {
  if (tool.kind === "read") {
    for (const raw of configuredModes) {
      if (normalizeToolPolicy(raw) === "disabled") return "disabled";
    }
    return "lookup";
  }
  if (
    procedureAllowedTools &&
    procedureAllowedTools.size > 0 &&
    !procedureAllowedTools.has(tool.name)
  ) {
    return "disabled";
  }
  let hasAuto = false;
  for (const raw of configuredModes) {
    const mode = normalizeToolPolicy(raw);
    if (mode === "disabled") return "disabled";
    if (mode === "ask") return "ask";
    if (mode === "auto_write") hasAuto = true;
  }
  return hasAuto ? "auto_write" : "ask";
}

/** Mints a random single-use approval token and its SHA-256 hex digest using Web Crypto. */
export async function mintApprovalToken(): Promise<{
  token: string;
  hash: string;
}> {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const hash = await hashApprovalToken(token);
  return { token, hash };
}

/** Computes the SHA-256 hex digest of an approval token. */
export async function hashApprovalToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Constant-time verification of a single-use approval token against its stored hex hash. */
export async function verifyApprovalToken(
  token: string,
  expectedHash: string,
): Promise<boolean> {
  const actualHash = await hashApprovalToken(token);
  if (actualHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

/** Who asks and about what: every tool call runs for this teammate in this workspace. */
export type ToolContext = {
  workspaceId: string;
  /** The asking teammate. */
  principalId: string;
  /** The asking teammate's Quills actions when the turn starts. */
  actions: readonly string[];
  conversationId: string | null;
  ticketId: string | null;
  /** The assistant's knowledge settings for this agent. */
  knowledge: { helpCenter: boolean; documents: boolean };
};
export type { ActionPreviewDiff, Conversation };
/** A change that a write tool made, recorded as a Quills event. */
export type ToolChange = {
  type:
    | "conversation.status_changed"
    | "conversation.priority_changed"
    | "conversation.tags_changed"
    | "conversation.assigned"
    | "conversation.attribute_changed"
    | "message.note_created";
  entityType: "conversation" | "conversation_message";
  entityId: string;
  payload: Record<string, string>;
};
/** What a read tool found: the text for the model, a short summary for the audit, its sources. */
export type ToolResult = {
  content: string;
  summary: string;
  sources?: {
    type: "article" | "snippet" | "document" | "webpage";
    id: string;
    title: string;
    excerpt: string;
  }[];
};

type Common<A extends z.ZodObject> = {
  name: string;
  description: string;
  args: A;
  /**
   * The Quills action the asking teammate must hold now, the same one as the teammate's own route.
   * Without it the model never sees the tool. A `required` tool needs `update`: the approval route
   * checks that action.
   */
  action: "read" | "create" | "update";
  /** Whether the tool fits this turn, for example only for a conversation. */
  available?(context: ToolContext): boolean;
};
export type ReadTool<A extends z.ZodObject = z.ZodObject> = Common<A> & {
  kind: "read";
  /** Runs at once, in a system-scoped read of the workspace, showing only what the teammate may read. */
  run(
    db: Database,
    context: ToolContext,
    args: z.output<A>,
  ): Promise<ToolResult>;
};
export type WriteTool<A extends z.ZodObject = z.ZodObject> = Common<A> & {
  kind: "write";
  /**
   * `required`: the call becomes a pending action, and it runs only when a teammate approves it, in
   * that teammate's request (assistant/pending-actions.ts). `auto`: allowed only when workspace
   * policy explicitly sets `auto_write`.
   */
  approval: "required" | "auto";
  /** What the teammate approves or what the audit shows, in one sentence. */
  summary(args: z.output<A>): string;
  /** Computes a structured before/after diff shown in the approval card before execution. */
  previewDiff?(
    conversation: Conversation | null,
    args: z.output<A>,
  ): ActionPreviewDiff;
  execute(
    db: Database,
    actor: QuillsActor,
    conversation: Conversation,
    args: z.output<A>,
  ): Promise<ToolChange | null>;
};
export type AiTool = ReadTool | WriteTool;

export const defineReadTool = <A extends z.ZodObject>(
  tool: Omit<ReadTool<A>, "kind">,
): ReadTool<A> => ({
  kind: "read",
  ...tool,
});
export const defineWriteTool = <A extends z.ZodObject>(
  tool: Omit<WriteTool<A>, "kind">,
): WriteTool<A> => ({
  kind: "write",
  ...tool,
});
/** The change event of a write tool on a conversation. */
export const conversationChange = (
  conversation: Conversation,
  type: ToolChange["type"],
  payload: Record<string, string> = {},
): ToolChange => ({
  type,
  entityType: "conversation",
  entityId: conversation.id,
  payload,
});
