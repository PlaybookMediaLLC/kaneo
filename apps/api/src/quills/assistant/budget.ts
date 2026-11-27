// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { settings } from "../../database/quills/schema/auth";
import { z } from "../../openapi";
import { openCredentials } from "../framework/integration-config";
import type { Database } from "../framework/define-route";
import { aiConfig, type AiConfig } from "./ai/config";
import { costOf } from "./ai/pricing";
import type { Message, Usage } from "./provider";

// The workspace AI limit (issue #23 & #302):
// - Optional workspace daily/monthly USD cost caps and monthly token cap in settings.assistant_budget_config
// - Optional env fallback QUILLS_AI_MONTHLY_TOKEN_LIMIT
// - Explicit graceful degradation behavior when caps are reached (draft_mode | cheaper_model | pause)
// - Reservation under a workspace advisory lock so parallel calls cannot pass the limit together.

const RESERVED = "reserved";
// Well above the provider's 60-second timeout, so a reservation outlives its call.
const RESERVATION_MINUTES = 5;
// The chat format adds a few tokens per message; 8 is above what OpenAI-compatible APIs add.
const MESSAGE_OVERHEAD = 8;

export const BUDGET_DEGRADE_BEHAVIORS = [
  "pause",
  "draft_mode",
  "cheaper_model",
] as const;
export type BudgetDegradeBehavior = (typeof BUDGET_DEGRADE_BEHAVIORS)[number];

export const assistantBudgetConfigSchema = z.object({
  dailyCapUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  monthlyCapUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  monthlyTokenCap: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000_000)
    .nullable()
    .default(null),
  alertThresholdPercent: z.number().int().min(10).max(100).default(80),
  degradeBehavior: z.enum(BUDGET_DEGRADE_BEHAVIORS).default("draft_mode"),
  cheaperModel: z.string().trim().max(120).nullable().default(null),
});

export type AssistantBudgetConfig = z.infer<typeof assistantBudgetConfigSchema>;

export function readBudgetConfig(raw: unknown): AssistantBudgetConfig {
  const parsed = assistantBudgetConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : assistantBudgetConfigSchema.parse({});
}

// Conservative fallback pricing per million tokens when QUILLS_AI_PRICES does not list a model.
// Ordered longest-prefix-first so e.g. "gpt-4o-mini" never matches "gpt-4o".
const FALLBACK_MODEL_PRICES: Array<
  [string, { input: number; output: number }]
> = [
  ["gemini-2.5-flash-lite", { input: 0.1, output: 0.4 }],
  ["claude-3-5-sonnet", { input: 3, output: 15 }],
  ["claude-3-5-haiku", { input: 0.8, output: 4 }],
  ["gemini-2.5-flash", { input: 0.15, output: 0.6 }],
  ["gemini-2.5-pro", { input: 1.25, output: 10 }],
  ["gpt-4o-mini", { input: 0.15, output: 0.6 }],
  ["gpt-4.1-mini", { input: 0.4, output: 1.6 }],
  ["gpt-4.1", { input: 2, output: 8 }],
  ["gpt-4o", { input: 2.5, output: 10 }],
];

/** Estimates a call's cost in US dollars (6 decimals) using QUILLS_AI_PRICES or conservative fallback rates. */
export function estimateCallCostUsd(usage: Usage | undefined): string | null {
  if (!usage) return null;
  const exact = costOf(usage);
  if (exact !== null) return exact;
  const normalized = usage.model.toLowerCase();
  const matched = FALLBACK_MODEL_PRICES.find(([prefix]) =>
    normalized.includes(prefix),
  )?.[1];
  const price = matched ?? { input: 0.5, output: 1.5 };
  return (
    (usage.inputTokens * price.input + usage.outputTokens * price.output) /
    1_000_000
  ).toFixed(6);
}

/** The configured env token limit, or null. Read on each call, like the provider settings. */
export function monthlyTokenLimit() {
  const value = Number(process.env.QUILLS_AI_MONTHLY_TOKEN_LIMIT?.trim() || "");
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// shortcut: above what current providers charge for one image (OpenAI, Anthropic and Gemini stay
// under 2,000 tokens); raise it if a provider bills an image higher.
const IMAGE_TOKENS = 5_000;

/**
 * The most a chat completion can cost. Byte-level tokenizers never make more tokens than the
 * text has UTF-8 bytes, so this bounds any prompt in any language.
 */
export const tokenCeiling = (messages: readonly Message[], maxTokens: number) =>
  messages.reduce(
    (sum, message) =>
      sum +
      MESSAGE_OVERHEAD +
      (Array.isArray(message.content)
        ? message.content.reduce(
            (bytes, part) =>
              bytes +
              (part.type === "text"
                ? Buffer.byteLength(part.text)
                : IMAGE_TOKENS),
            0,
          )
        : Buffer.byteLength(message.content ?? "")),
    maxTokens,
  );

export type AiBudgetCheck = {
  allowed: boolean;
  degradedMode: "normal" | BudgetDegradeBehavior;
  cheaperModel: string | null;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  monthlyTokens: number;
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
  monthlyTokenCap: number | null;
  usagePercent: number;
  alertTriggered: boolean;
  reason: string | null;
};

/** Evaluates workspace AI budget state (daily USD, monthly USD, monthly tokens) without throwing. */
export async function checkAiBudget(db: Database): Promise<AiBudgetCheck> {
  const [settingsRow] = await db
    .select({ budgetConfig: settings.assistantBudgetConfig })
    .from(settings)
    .limit(1);
  const config = readBudgetConfig(settingsRow?.budgetConfig);
  const envTokenCap = monthlyTokenLimit();
  const effectiveTokenCap =
    config.monthlyTokenCap !== null && envTokenCap !== null
      ? Math.min(config.monthlyTokenCap, envTokenCap)
      : (config.monthlyTokenCap ?? envTokenCap);

  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const liveReservationCutoff = new Date(
    now.getTime() - RESERVATION_MINUTES * 60_000,
  );
  const activeUsageFilter = sql`(${aiUsageLog.status} <> ${RESERVED} OR ${aiUsageLog.createdAt} >= ${liveReservationCutoff})`;

  const [monthAgg] = await db
    .select({
      tokens: sql<string>`coalesce(sum(${aiUsageLog.totalTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0)`,
    })
    .from(aiUsageLog)
    .where(and(gte(aiUsageLog.createdAt, monthStart), activeUsageFilter));

  const [dayAgg] = await db
    .select({
      costUsd: sql<string>`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0)`,
    })
    .from(aiUsageLog)
    .where(and(gte(aiUsageLog.createdAt, dayStart), activeUsageFilter));

  const monthlyTokens = Number(monthAgg?.tokens ?? 0);
  const monthlySpendUsd = Number(monthAgg?.costUsd ?? 0);
  const dailySpendUsd = Number(dayAgg?.costUsd ?? 0);

  const ratios: number[] = [];
  let exceededReason: string | null = null;
  if (config.dailyCapUsd !== null) {
    ratios.push(
      config.dailyCapUsd === 0
        ? 100
        : (dailySpendUsd / config.dailyCapUsd) * 100,
    );
    if (dailySpendUsd >= config.dailyCapUsd)
      exceededReason = "daily_usd_cap_reached";
  }
  if (config.monthlyCapUsd !== null) {
    ratios.push(
      config.monthlyCapUsd === 0
        ? 100
        : (monthlySpendUsd / config.monthlyCapUsd) * 100,
    );
    if (monthlySpendUsd >= config.monthlyCapUsd)
      exceededReason = exceededReason ?? "monthly_usd_cap_reached";
  }
  if (effectiveTokenCap !== null && effectiveTokenCap > 0) {
    ratios.push((monthlyTokens / effectiveTokenCap) * 100);
    if (monthlyTokens >= effectiveTokenCap)
      exceededReason = exceededReason ?? "monthly_token_cap_reached";
  }

  const usagePercent = ratios.length
    ? Math.round(Math.max(...ratios) * 10) / 10
    : 0;
  const alertTriggered =
    ratios.length > 0 && usagePercent >= config.alertThresholdPercent;

  if (exceededReason) {
    return {
      allowed: config.degradeBehavior !== "pause",
      degradedMode: config.degradeBehavior,
      cheaperModel: config.cheaperModel,
      dailySpendUsd,
      monthlySpendUsd,
      monthlyTokens,
      dailyCapUsd: config.dailyCapUsd,
      monthlyCapUsd: config.monthlyCapUsd,
      monthlyTokenCap: effectiveTokenCap,
      usagePercent,
      alertTriggered,
      reason: exceededReason,
    };
  }

  return {
    allowed: true,
    degradedMode: "normal",
    cheaperModel: config.cheaperModel,
    dailySpendUsd,
    monthlySpendUsd,
    monthlyTokens,
    dailyCapUsd: config.dailyCapUsd,
    monthlyCapUsd: config.monthlyCapUsd,
    monthlyTokenCap: effectiveTokenCap,
    usagePercent,
    alertTriggered,
    reason: null,
  };
}

/**
 * Reserves the call's ceiling in the scoped workspace, or 409 when it would pass this month's
 * limit. Null without a limit. Runs in `prepare`, so the reservation commits before the call.
 */
export async function reserveAiBudget(
  db: Database,
  step: string,
  ceiling: number,
): Promise<string | null> {
  const [settingsRow] = await db
    .select({ budgetConfig: settings.assistantBudgetConfig })
    .from(settings)
    .limit(1);
  const config = readBudgetConfig(settingsRow?.budgetConfig);
  const envLimit = monthlyTokenLimit();
  const limit =
    config.monthlyTokenCap !== null && envLimit !== null
      ? Math.min(config.monthlyTokenCap, envLimit)
      : (config.monthlyTokenCap ?? envLimit);

  const hasCostCap =
    (config.dailyCapUsd !== null && config.dailyCapUsd >= 0) ||
    (config.monthlyCapUsd !== null && config.monthlyCapUsd >= 0);

  if (limit === null && !hasCostCap) return null;

  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext('quills-ai-budget'), hashtext(current_setting('quills.workspace_id')))`,
  );
  const now = new Date();
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await db
    .delete(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.status, RESERVED),
        lt(
          aiUsageLog.createdAt,
          new Date(now.getTime() - RESERVATION_MINUTES * 60_000),
        ),
      ),
    );
  const [row] = await db
    .select({
      used: sql<string>`coalesce(sum(${aiUsageLog.totalTokens}), 0)`,
      monthlyCost: sql<string>`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0)`,
    })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.createdAt, month));

  if (limit !== null && Number(row?.used ?? 0) + ceiling > limit)
    throw new HTTPException(409, {
      message: "The workspace reached its monthly AI limit",
    });

  if (
    config.monthlyCapUsd !== null &&
    config.degradeBehavior === "pause" &&
    Number(row?.monthlyCost ?? 0) >= config.monthlyCapUsd
  )
    throw new HTTPException(409, {
      message: "The workspace reached its monthly AI cost cap",
    });

  if (config.dailyCapUsd !== null && config.degradeBehavior === "pause") {
    const [dayRow] = await db
      .select({
        dailyCost: sql<string>`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0)`,
      })
      .from(aiUsageLog)
      .where(gte(aiUsageLog.createdAt, day));
    if (Number(dayRow?.dailyCost ?? 0) >= config.dailyCapUsd)
      throw new HTTPException(409, {
        message: "The workspace reached its daily AI cost cap",
      });
  }

  const hasAnyCap =
    limit !== null ||
    config.dailyCapUsd !== null ||
    config.monthlyCapUsd !== null;
  if (!hasAnyCap) return null;

  const reservedEstimate = estimateCallCostUsd({
    model: aiConfig()?.model ?? "gpt-4o",
    inputTokens: Math.ceil(ceiling * 0.7),
    outputTokens: Math.ceil(ceiling * 0.3),
    totalTokens: ceiling,
    durationMs: 0,
  });
  const [reserved] = await db
    .insert(aiUsageLog)
    .values({
      pipelineStep: step.slice(0, 30),
      callType: "chat_completion",
      model: "reserved",
      totalTokens: ceiling,
      estimatedCostUsd: reservedEstimate,
      durationMs: 0,
      status: RESERVED,
    })
    .returning({ id: aiUsageLog.id });
  return reserved!.id;
}

/** Drops a reservation; the handler logs the real usage in the same transaction. */
export async function releaseAiBudget(db: Database, id: string | null) {
  if (id)
    await db
      .delete(aiUsageLog)
      .where(
        and(eq(aiUsageLog.id, id as never), eq(aiUsageLog.status, RESERVED)),
      );
}

/**
 * Resolves the effective AiConfig for a workspace (#302):
 * merges encrypted workspace BYOK credentials (`settings.assistant_provider_secrets`) over
 * instance defaults, and applies a degraded `cheaperModel` override when budget degradation is active.
 */
export async function resolveWorkspaceAiConfig(
  db: Database,
  cheaperModelOverride?: string | null,
): Promise<AiConfig | null> {
  const base = aiConfig();
  const [row] = await db
    .select({ providerSecrets: settings.assistantProviderSecrets })
    .from(settings)
    .limit(1);
  let resolved: AiConfig | null = base
    ? { ...base, models: { ...base.models } }
    : null;
  if (row?.providerSecrets) {
    try {
      const parsed = JSON.parse(row.providerSecrets) as {
        baseUrl?: string | null;
        chatModel?: string | null;
        embeddingModel?: string | null;
        sealedApiKey?: string;
      };
      if (parsed.sealedApiKey) {
        const opened = openCredentials(parsed.sealedApiKey);
        const byokKey =
          typeof opened?.apiKey === "string" ? opened.apiKey.trim() : "";
        const byokUrl =
          typeof parsed.baseUrl === "string" &&
          parsed.baseUrl.startsWith("https://")
            ? parsed.baseUrl.replace(/\/+$/, "")
            : resolved?.baseUrl;
        const byokModel =
          typeof parsed.chatModel === "string" && parsed.chatModel.trim()
            ? parsed.chatModel.trim()
            : resolved?.model;
        if (byokKey && byokUrl && byokModel) {
          resolved = {
            baseUrl: byokUrl,
            apiKey: byokKey,
            model: byokModel,
            models: {
              fast: byokModel,
              deep: byokModel,
            },
            embeddingModel:
              typeof parsed.embeddingModel === "string" &&
              parsed.embeddingModel.trim()
                ? parsed.embeddingModel.trim()
                : (resolved?.embeddingModel ?? null),
          };
        }
      }
    } catch {
      // Malformed or undecryptable BYOK payload falls back cleanly to instance config.
    }
  }
  if (resolved && cheaperModelOverride?.trim()) {
    const cheap = cheaperModelOverride.trim();
    resolved = {
      ...resolved,
      models: { ...resolved.models, fast: cheap },
    };
  }
  return resolved;
}
