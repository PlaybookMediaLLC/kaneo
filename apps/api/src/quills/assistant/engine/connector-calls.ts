import { and, asc, eq, sql } from "drizzle-orm";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { assistantPendingActions } from "../../../database/quills/schema/assistant-pending-actions";
import { assistantToolCalls } from "../../../database/quills/schema/assistant-tool-calls";
import { connectors } from "../../../database/quills/schema/connectors";
import { recordQuillsChange } from "../../events";
import {
  openCredentials,
  sealCredentials,
} from "../../framework/integration-config";
import { signedUrl } from "../../integrations/oauth-providers";
import { callTool, failureText, type Failure } from "../connector-client";
import {
  connectorCall,
  isConnectorTool,
  liveTool,
  offerColumns,
  offeredTools,
  type OfferedTool,
} from "../connector-tools";
import { untrusted } from "../provider";
import { nothing, requesterActions, type Work, type Write } from "./shared";

// Connector tool calls in the worker. A call never runs in a transaction: it is claimed (a
// `started` tool-call row) in one, made with none open, and recorded in another. The claim's key
// makes a repeated job attempt skip a call that already ran. The server's text reaches the model
// only as a bounded tool result inside <tool_result>; a failure is fixed text. ROUTES.md,
// "Connector tools".

const MAX_CALLS = 5;
const BUDGET_MS = 30_000;
const STEP_MS = 10_000;
const MIN_STEP_MS = 1_000;

const toModel: Record<Failure | "tool_error" | "unavailable", string> = {
  destination:
    "Failed: the connector's address cannot be reached from this workspace.",
  unauthorized: "Failed: the connector needs a new authorization.",
  rejected: "Failed: the connector's authorization server refused the request.",
  unreachable:
    "Failed: the connector did not answer in time, or it could not be reached.",
  tool_error: "Failed: the connector's tool reported an error.",
  unavailable: "Failed: the connector was turned off or removed.",
};

/** A connector that offers tools to the copilot: enabled, connected and assigned to it. */
const live = and(
  eq(connectors.enabled, true),
  eq(connectors.status, "connected"),
  sql`${connectors.assignments} @> '{"copilot": true}'::jsonb`,
);

/** The connector tools offered to one copilot run, read in the job's workspace. */
export const loadConnectorTools = (workspaceId: string) =>
  withQuillsSystemWorkspace(workspaceId, async (db) =>
    offeredTools(
      await db
        .select(offerColumns)
        .from(connectors)
        .where(live)
        .orderBy(asc(connectors.name))
        .limit(100),
    ),
  );

/**
 * The connector calls of one run: at most MAX_CALLS calls and BUDGET_MS of call time in all (the
 * provider's time does not count), each call at most STEP_MS. `work` gets its deadline; the
 * answer is null, and nothing runs, when the run used its calls or has less than MIN_STEP_MS left.
 */
export function connectorBudget() {
  let calls = 0;
  let used = 0;
  return async <T>(work: (timeoutMs: number) => Promise<T>) => {
    const left = Math.min(STEP_MS, BUDGET_MS - used);
    if (calls >= MAX_CALLS || left < MIN_STEP_MS) return null;
    calls++;
    const started = Date.now();
    try {
      return await work(left);
    } finally {
      used += Date.now() - started;
    }
  };
}

/** Only sizes and the connector: a connector tool's arguments go to an outside service. */
export const callMetadata = (
  connectorId: string | null,
  args: Record<string, unknown>,
  resultBytes: number | null = null,
) => ({
  connectorId,
  argsBytes: JSON.stringify(args).length,
  resultBytes,
});

type Claim = {
  key: string;
  principalId: string;
  conversationId: string | null;
  pendingActionId?: string;
};
type Outcome = { duplicate: string } | { ok: boolean; content: string };

/**
 * Claims, makes and records one call. A claim that already exists returns its status and makes no
 * call. Rotated OAuth tokens are stored only when the stored secrets did not change meanwhile and
 * the new secrets still hold tokens.
 */
export async function callConnector(
  workspaceId: string,
  tool: OfferedTool,
  args: Record<string, unknown>,
  claim: Claim,
  timeoutMs: number,
): Promise<Outcome> {
  const started = Date.now();
  const claimed = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [row] = await db
      .insert(assistantToolCalls)
      .values({
        conversationId: claim.conversationId as never,
        pendingActionId: (claim.pendingActionId ?? null) as never,
        toolName: tool.name,
        args: callMetadata(tool.connectorId, args),
        status: "started",
        idempotencyKey: claim.key,
        principalId: claim.principalId as never,
      })
      .onConflictDoNothing()
      .returning({ id: assistantToolCalls.id });
    if (!row) {
      const [prior] = await db
        .select({ status: assistantToolCalls.status })
        .from(assistantToolCalls)
        .where(eq(assistantToolCalls.idempotencyKey, claim.key));
      return { prior: prior?.status ?? "started" };
    }
    const [stored] = await db
      .select({
        url: connectors.url,
        authMode: connectors.authMode,
        sealed: connectors.secrets,
      })
      .from(connectors)
      // A connector turned off during the run gets no more calls.
      .where(and(eq(connectors.id, tool.connectorId as never), live));
    return { id: row.id, stored };
  });
  if (!claimed.id) return { duplicate: claimed.prior ?? "started" };
  const { id, stored } = claimed;
  const secrets = (stored && openCredentials(stored.sealed)) ?? {};
  const answer: Awaited<ReturnType<typeof callTool>> = stored
    ? await callTool(
        {
          url: stored.url,
          authMode: stored.authMode,
          secrets,
          redirectUrl: signedUrl(
            `/oauth/connectors/${tool.connectorId}/callback`,
          ),
        },
        tool.tool,
        args,
        timeoutMs,
      )
    : { secrets, failure: "unreachable" };
  const { failure, text } = answer;
  const kind = !stored
    ? "unavailable"
    : (failure ?? (answer.error ? "tool_error" : null));
  const rotated =
    stored && answer.secrets.tokens && answer.secrets.tokens !== secrets.tokens;
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    await db
      .update(assistantToolCalls)
      .set({
        status: kind ? "failed" : "succeeded",
        resultSummary: kind
          ? toModel[kind]
          : answer.truncated
            ? "Succeeded (truncated)"
            : "Succeeded",
        error: kind,
        latencyMs: Date.now() - started,
        args: callMetadata(tool.connectorId, args, answer.size ?? null),
      })
      .where(eq(assistantToolCalls.id, id));
    if (!stored) return;
    await db
      .update(connectors)
      .set({
        lastCallAt: new Date(),
        ...(failure && {
          lastError: failureText[failure],
          lastErrorAt: new Date(),
          errorCount: sql`${connectors.errorCount} + 1`,
        }),
      })
      .where(eq(connectors.id, tool.connectorId as never));
    // Compare and set: a parallel refresh or authorization may hold newer tokens.
    if (rotated)
      await db
        .update(connectors)
        .set({ secrets: sealCredentials(answer.secrets) })
        .where(
          and(
            eq(connectors.id, tool.connectorId as never),
            sql`${connectors.secrets} IS NOT DISTINCT FROM ${stored.sealed}`,
          ),
        );
  });
  return kind || text === undefined
    ? { ok: false, content: toModel[kind ?? "unreachable"] }
    : {
        ok: true,
        content: untrusted(
          "tool_result",
          answer.truncated ? `${text}\n[truncated]` : text,
        ),
      };
}

/**
 * assistant_action.approved: runs an approved connector action once, as its approver. Any other
 * action is left as it is. The approver's update permission and the connector are checked again.
 */
export const runApprovedAction: Work = async (workspaceId, event) => {
  const found = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [action] = await db
      .select({
        id: assistantPendingActions.id,
        toolName: assistantPendingActions.toolName,
        args: assistantPendingActions.args,
        status: assistantPendingActions.status,
        conversationId: assistantPendingActions.conversationId,
        decidedById: assistantPendingActions.decidedById,
      })
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, event.entityId as never));
    if (action?.status !== "approved" || !isConnectorTool(action.toolName))
      return null;
    // A claim from an earlier attempt decides the outcome before any check that may have changed.
    const [claim] = await db
      .select({ status: assistantToolCalls.status })
      .from(assistantToolCalls)
      .where(eq(assistantToolCalls.idempotencyKey, `action:${action.id}`));
    const call = connectorCall.safeParse(action.args);
    return {
      action,
      claim,
      call: call.success ? call.data : null,
      tool:
        call.success && !claim
          ? await liveTool(db, call.data, action.toolName)
          : null,
    };
  });
  if (!found) return nothing;
  const { action, claim, call, tool } = found;
  const key = `action:${action.id}`;
  const finish =
    (ok: boolean, refused?: string): Write =>
    async (db) => {
      if (refused)
        await db
          .insert(assistantToolCalls)
          .values({
            conversationId: action.conversationId,
            pendingActionId: action.id,
            toolName: action.toolName.slice(0, 100),
            args: callMetadata(
              call?.connectorId ?? null,
              call?.arguments ?? {},
            ),
            status: "denied",
            resultSummary: refused,
            idempotencyKey: key,
            principalId: action.decidedById,
          })
          .onConflictDoNothing();
      const [row] = await db
        .update(assistantPendingActions)
        .set({
          status: ok ? "executed" : "failed",
          executedAt: ok ? new Date() : null,
          result: { ok },
        })
        .where(
          and(
            eq(assistantPendingActions.id, action.id),
            eq(assistantPendingActions.status, "approved"),
          ),
        )
        .returning({ id: assistantPendingActions.id });
      if (row)
        await recordQuillsChange(db, null, {
          type: "assistant_action.completed",
          entityType: "assistant_action",
          entityId: action.id,
          payload: { status: ok ? "executed" : "failed" },
        });
    };
  // A claim that never got its outcome (the worker stopped during the call) counts as failed.
  if (claim) return finish(claim.status === "succeeded");
  if (!call || !tool)
    return finish(false, "Not run: the connector or its tool changed");
  if (
    !action.decidedById ||
    !(await requesterActions(workspaceId, action.decidedById)).includes(
      "update",
    )
  )
    return finish(false, "Not run: the approver no longer has update");
  const outcome = await callConnector(
    workspaceId,
    tool,
    call.arguments,
    {
      key,
      principalId: action.decidedById,
      conversationId: action.conversationId,
      pendingActionId: action.id,
    },
    STEP_MS,
  );
  return finish(
    "duplicate" in outcome ? outcome.duplicate === "succeeded" : outcome.ok,
  );
};
