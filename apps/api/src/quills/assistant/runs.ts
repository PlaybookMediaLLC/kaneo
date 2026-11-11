// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, gt, sql } from "drizzle-orm";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { kvStore } from "../../database/quills/schema/kv";
import type { Database } from "../framework/define-route";
import { z } from "../../openapi";
import type { AiErrorCode, Usage } from "./provider";

// An assistant run is one AI request that a worker answers: a copilot question, a translation,
// a preview or a widget answer. The route stores it in kv_store for a day; the worker reads it,
// calls the provider outside any transaction, and writes the answer back in a new one.

export const RUN_KINDS = [
  "copilot",
  "translate_message",
  "attribute_preview",
  "ticket_fields",
  "kb_ask",
] as const;
export type RunKind = (typeof RUN_KINDS)[number];
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const key = (id: string) => `assistant:run:${id}`;

const citation = z.object({
  type: z.enum(["article", "snippet", "document", "webpage", "post"]),
  id: z.string(),
  title: z.string(),
});
const suggestion = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  reason: z.string().nullable(),
});
export const runOutput = z.object({
  text: z.string().nullable(),
  citations: z.array(citation),
  proposedActionIds: z.array(z.string()),
  values: z.array(suggestion),
});
export type RunOutput = z.infer<typeof runOutput>;
const stored = z.object({
  kind: z.enum(RUN_KINDS),
  principalId: z.string(),
  status: z.enum(["pending", "succeeded", "failed"]),
  input: z.record(z.string(), z.unknown()),
  output: runOutput.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Run = z.infer<typeof stored>;

/** The public shape of a run. The input stays on the server. */
export const runSchema = z.object({
  id: z.string(),
  kind: z.enum(RUN_KINDS),
  status: z.enum(["pending", "succeeded", "failed"]),
  output: runOutput.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
/** A run still pending after this long has failed: its job was lost or ran out of attempts. */
const STALE_MS = 30 * 60 * 1000;
export const runView = (id: string, run: Run): z.input<typeof runSchema> => {
  const stale =
    run.status === "pending" &&
    Date.now() - Date.parse(run.createdAt) > STALE_MS;
  return {
    id,
    kind: run.kind,
    status: stale ? "failed" : run.status,
    output: run.output,
    error: stale
      ? "The assistant did not answer in time. Ask again."
      : run.error,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
};

export async function createRun(
  db: Database,
  principalId: string,
  kind: RunKind,
  input: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  const run: Run = {
    kind,
    principalId,
    status: "pending",
    input,
    output: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  await db.insert(kvStore).values({
    workspaceKey: "_",
    key: key(id),
    value: run,
    expiresAt: new Date(Date.now() + RUN_TTL_MS),
  });
  return { id, run };
}

/** A live run, or undefined when it expired or never existed. `lock` holds it for an update. */
export async function readRun(db: Database, id: string, lock = false) {
  const query = db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, key(id)),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    );
  const [row] = await (lock ? query.for("update") : query);
  const run = stored.safeParse(row?.value);
  return run.success ? run.data : undefined;
}

/** Stores a run's outcome. Only a pending run changes; a repeat returns false. */
export async function finishRun(
  db: Database,
  id: string,
  outcome:
    | { status: "succeeded"; output: RunOutput }
    | { status: "failed"; error: string },
) {
  const run = await readRun(db, id, true);
  if (!run || run.status !== "pending") return false;
  await db
    .update(kvStore)
    .set({
      value: {
        ...run,
        status: outcome.status,
        output: outcome.status === "succeeded" ? outcome.output : null,
        error: outcome.status === "failed" ? outcome.error : null,
        finishedAt: new Date().toISOString(),
      } satisfies Run,
    })
    .where(and(eq(kvStore.workspaceKey, "_"), eq(kvStore.key, key(id))));
  return true;
}

/** One ai_usage_log row per provider call. `error` is the fixed failure code, never provider text. */
export type UsageEntry = {
  step: string;
  callType: "chat_completion" | "embedding";
  usage?: Usage;
  error?: AiErrorCode;
  postId?: string;
  metadata?: Record<string, string | number | boolean | string[]>;
};
export async function logUsage(db: Database, entries: UsageEntry[]) {
  if (!entries.length) return;
  await db.insert(aiUsageLog).values(
    entries.map((entry) => ({
      pipelineStep: entry.step.slice(0, 30),
      callType: entry.callType,
      model: (entry.usage?.model ?? "unknown").slice(0, 100),
      postId: entry.postId as never,
      inputTokens: entry.usage?.inputTokens ?? 0,
      outputTokens: entry.usage?.outputTokens ?? 0,
      totalTokens: entry.usage?.totalTokens ?? 0,
      durationMs: entry.usage?.durationMs ?? 0,
      status: entry.error ? "error" : "success",
      error: entry.error ?? null,
      metadata: entry.metadata ?? null,
    })),
  );
}
