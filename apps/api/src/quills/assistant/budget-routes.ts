import { isNotNull, sql, sum } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import {
  credentialText,
  sealCredentials,
  validateWebhookUrl,
} from "../framework/integration-config";
import {
  assistantBudgetConfigSchema,
  BUDGET_DEGRADE_BEHAVIORS,
  checkAiBudget,
  readBudgetConfig,
} from "./budget";

const providerViewSchema = z.object({
  hasCustomKey: z.boolean(),
  providerName: z.string().nullable(),
  baseUrl: z.string().nullable(),
  chatModel: z.string().nullable(),
  embeddingModel: z.string().nullable(),
});

function readProviderView(raw: unknown): z.infer<typeof providerViewSchema> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      hasCustomKey: false,
      providerName: null,
      baseUrl: null,
      chatModel: null,
      embeddingModel: null,
    };
  }
  const rec = parsed as Record<string, unknown>;
  return {
    hasCustomKey:
      typeof rec.sealedApiKey === "string" && rec.sealedApiKey.length > 0,
    providerName:
      typeof rec.providerName === "string" ? rec.providerName : null,
    baseUrl: typeof rec.baseUrl === "string" ? rec.baseUrl : null,
    chatModel: typeof rec.chatModel === "string" ? rec.chatModel : null,
    embeddingModel:
      typeof rec.embeddingModel === "string" ? rec.embeddingModel : null,
  };
}

const getBudget = defineQuillsRoute({
  method: "get",
  path: "/assistant/budget",
  operationId: "getQuillsAssistantBudget",
  summary: "Get AI spend caps, live usage, projected spend and BYOK status",
  description:
    "Returns workspace daily/monthly USD caps, token cap, degradation behavior, live cost/token breakdown by feature and conversation, and BYOK provider metadata (never API keys).",
  action: "read",
  response: z.object({
    config: assistantBudgetConfigSchema,
    usage: z.object({
      dailySpendUsd: z.number(),
      monthlySpendUsd: z.number(),
      monthlyTokens: z.number(),
      projectedMonthlySpendUsd: z.number(),
      usagePercent: z.number(),
      alertTriggered: z.boolean(),
      degradedMode: z.enum(["normal", ...BUDGET_DEGRADE_BEHAVIORS]),
      reason: z.string().nullable(),
      byStep: z.array(
        z.object({
          step: z.string(),
          calls: z.number(),
          totalTokens: z.number(),
          spendUsd: z.number(),
        }),
      ),
      topConversations: z.array(
        z.object({
          conversationId: z.string(),
          calls: z.number(),
          totalTokens: z.number(),
          spendUsd: z.number(),
        }),
      ),
    }),
    provider: providerViewSchema,
  }),
  allowKeys: ["monthlyTokenCap", "monthlyTokens", "totalTokens"],
  responseDescription:
    "AI budget configuration, spend telemetry and BYOK status",
  handler: async ({ db }) => {
    const [row] = await db
      .select({
        budgetConfig: settings.assistantBudgetConfig,
        providerSecrets: settings.assistantProviderSecrets,
      })
      .from(settings)
      .limit(1);
    const config = readBudgetConfig(row?.budgetConfig);
    const budget = await checkAiBudget(db);
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const elapsedDays = Math.max(
      1 / 24,
      (now.getTime() - monthStart.getTime()) / 86_400_000,
    );
    const projectedMonthlySpendUsd =
      Math.round((budget.monthlySpendUsd / elapsedDays) * daysInMonth * 10000) /
      10000;

    const byStep = await db
      .select({
        step: aiUsageLog.pipelineStep,
        calls: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(${sum(aiUsageLog.totalTokens)}, 0)::double precision`,
        spendUsd: sql<string>`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0)`,
      })
      .from(aiUsageLog)
      .where(
        sql`${aiUsageLog.createdAt} >= ${monthStart} and ${aiUsageLog.status} <> 'reserved'`,
      )
      .groupBy(aiUsageLog.pipelineStep)
      .orderBy(
        sql`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0) desc`,
      )
      .limit(50);

    const topConversations = await db
      .select({
        conversationId: aiUsageLog.conversationId,
        calls: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(${sum(aiUsageLog.totalTokens)}, 0)::double precision`,
        spendUsd: sql<string>`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0)`,
      })
      .from(aiUsageLog)
      .where(
        sql`${aiUsageLog.createdAt} >= ${monthStart} and ${aiUsageLog.status} <> 'reserved' and ${isNotNull(aiUsageLog.conversationId)}`,
      )
      .groupBy(aiUsageLog.conversationId)
      .orderBy(
        sql`coalesce(sum(coalesce(${aiUsageLog.costUsd}, ${aiUsageLog.estimatedCostUsd}, 0)), 0) desc`,
      )
      .limit(20);

    return {
      config,
      usage: {
        dailySpendUsd: Math.round(budget.dailySpendUsd * 1000000) / 1000000,
        monthlySpendUsd: Math.round(budget.monthlySpendUsd * 1000000) / 1000000,
        monthlyTokens: budget.monthlyTokens,
        projectedMonthlySpendUsd,
        usagePercent: budget.usagePercent,
        alertTriggered: budget.alertTriggered,
        degradedMode: budget.degradedMode,
        reason: budget.reason,
        byStep: byStep.map((item) => ({
          step: item.step,
          calls: item.calls,
          totalTokens: item.totalTokens,
          spendUsd: Number(item.spendUsd),
        })),
        topConversations: topConversations
          .filter((item): item is typeof item & { conversationId: string } =>
            Boolean(item.conversationId),
          )
          .map((item) => ({
            conversationId: item.conversationId,
            calls: item.calls,
            totalTokens: item.totalTokens,
            spendUsd: Number(item.spendUsd),
          })),
      },
      provider: readProviderView(row?.providerSecrets),
    };
  },
});

const updateBudget = defineQuillsRoute({
  method: "patch",
  path: "/assistant/budget",
  operationId: "updateQuillsAssistantBudget",
  summary: "Update AI daily/monthly spend caps and degradation behavior",
  action: "manage_settings",
  body: z
    .object({
      dailyCapUsd: z.number().min(0).max(1_000_000).nullable().optional(),
      monthlyCapUsd: z.number().min(0).max(1_000_000).nullable().optional(),
      monthlyTokenCap: z
        .number()
        .int()
        .min(1)
        .max(1_000_000_000_000)
        .nullable()
        .optional(),
      alertThresholdPercent: z.number().int().min(10).max(100).optional(),
      degradeBehavior: z.enum(BUDGET_DEGRADE_BEHAVIORS).optional(),
      cheaperModel: z.string().trim().max(120).nullable().optional(),
    })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Change at least one field",
    ),
  response: z.object({ config: assistantBudgetConfigSchema }),
  responseDescription: "The saved AI budget configuration",
  allowKeys: ["monthlyTokenCap"],
  event: (_input, result) => ({
    type: "settings.ai_budget_updated",
    entityType: "settings",
    entityId: "ai_budget",
    payload: {
      degradeBehavior: result.config.degradeBehavior,
      dailyCapUsd: String(result.config.dailyCapUsd ?? "none"),
      monthlyCapUsd: String(result.config.monthlyCapUsd ?? "none"),
    },
  }),
  handler: async ({ db, body }) => {
    const [row] = await db
      .select({ budgetConfig: settings.assistantBudgetConfig })
      .from(settings)
      .limit(1)
      .for("update");
    const current = readBudgetConfig(row?.budgetConfig);
    const next = assistantBudgetConfigSchema.parse({
      dailyCapUsd:
        body.dailyCapUsd !== undefined ? body.dailyCapUsd : current.dailyCapUsd,
      monthlyCapUsd:
        body.monthlyCapUsd !== undefined
          ? body.monthlyCapUsd
          : current.monthlyCapUsd,
      monthlyTokenCap:
        body.monthlyTokenCap !== undefined
          ? body.monthlyTokenCap
          : current.monthlyTokenCap,
      alertThresholdPercent:
        body.alertThresholdPercent ?? current.alertThresholdPercent,
      degradeBehavior: body.degradeBehavior ?? current.degradeBehavior,
      cheaperModel:
        body.cheaperModel !== undefined
          ? body.cheaperModel
          : current.cheaperModel,
    });
    await db.update(settings).set({ assistantBudgetConfig: next });
    return { config: next };
  },
});

const putProviderKeys = defineQuillsRoute({
  method: "put",
  path: "/assistant/provider-keys",
  operationId: "setQuillsAssistantProviderKeys",
  summary: "Configure workspace BYOK AI provider credentials",
  description:
    "Encrypts the provider API key with NOTIFICATION_SECRET_ENCRYPTION_KEY and stores only ciphertext. The plaintext key is never returned.",
  action: "manage_settings",
  body: z.object({
    providerName: z.string().trim().min(1).max(60),
    baseUrl: z.url().max(300).optional(),
    apiKey: z.string().min(8).max(400).regex(credentialText),
    chatModel: z.string().trim().min(1).max(120).optional(),
    embeddingModel: z.string().trim().min(1).max(120).optional(),
  }),
  response: z.object({ provider: providerViewSchema }),
  responseDescription: "Saved BYOK provider metadata (never includes apiKey)",
  errors: {
    400: "Invalid or disallowed provider baseUrl",
    409: "Set NOTIFICATION_SECRET_ENCRYPTION_KEY to store BYOK AI credentials",
  },
  event: ({ body }) => ({
    type: "settings.ai_provider_keys_updated",
    entityType: "settings",
    entityId: "ai_provider_keys",
    payload: { action: "set", providerName: body.providerName },
  }),
  handler: async ({ db, body }) => {
    if (body.baseUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(body.baseUrl);
      } catch {
        throw new HTTPException(400, { message: "Invalid provider baseUrl" });
      }
      if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        throw new HTTPException(400, {
          message: "Provider baseUrl must be a clean https:// URL",
        });
      }
      try {
        await validateWebhookUrl(body.baseUrl);
      } catch {
        throw new HTTPException(400, {
          message: "Provider baseUrl is not allowed (SSRF protection)",
        });
      }
    }
    const sealedApiKey = sealCredentials({ apiKey: body.apiKey });
    const stored = {
      providerName: body.providerName,
      baseUrl: body.baseUrl ?? null,
      chatModel: body.chatModel ?? null,
      embeddingModel: body.embeddingModel ?? null,
      sealedApiKey,
      updatedAt: new Date().toISOString(),
    };
    await db.update(settings).set({
      assistantProviderSecrets: JSON.stringify(stored),
    });
    return { provider: readProviderView(stored) };
  },
});

const deleteProviderKeys = defineQuillsRoute({
  method: "delete",
  path: "/assistant/provider-keys",
  operationId: "deleteQuillsAssistantProviderKeys",
  summary: "Remove workspace BYOK AI provider credentials",
  action: "manage_settings",
  response: z.object({ provider: providerViewSchema }),
  responseDescription: "Cleared BYOK provider status",
  event: () => ({
    type: "settings.ai_provider_keys_updated",
    entityType: "settings",
    entityId: "ai_provider_keys",
    payload: { action: "deleted" },
  }),
  handler: async ({ db }) => {
    await db.update(settings).set({ assistantProviderSecrets: null });
    return { provider: readProviderView(null) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getBudget)
  .openapi(...updateBudget)
  .openapi(...putProviderKeys)
  .openapi(...deleteProviderKeys);
