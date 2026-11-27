// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import type { ModelRole } from "@quills/ai/capability";
import { embedMany, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "../../../openapi";
import { aiConfig, type AiConfig } from "./config";
import { AiError, toAiError } from "./errors";
import { toModelMessages } from "./messages";
import { embeddingModel, languageModel } from "./registry";
import { repairJson } from "./repair";
import type { Message, Usage } from "./types";

// The JSON call and the embeddings that Quills AI features use through provider.ts; the tool loop is
// agent.ts.

const TIMEOUT_MS = 60_000;
/** Embeddings are stored in vector(1536) columns. */
export const EMBEDDING_DIMENSIONS = 1536;

export const usageOf = (
  model: string,
  usage:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined,
  started: number,
): Usage => {
  // A provider may leave usage out; the AI SDK then reports NaN, which the usage row cannot store.
  const count = (value: number | undefined) =>
    Number.isFinite(value) ? (value as number) : undefined;
  const inputTokens = count(usage?.inputTokens) ?? 0;
  const outputTokens = count(usage?.outputTokens) ?? 0;
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: count(usage?.totalTokens) ?? inputTokens + outputTokens,
    durationMs: Date.now() - started,
  };
};

/**
 * A chat completion whose answer must be a JSON object that `schema` accepts. The provider gets the
 * JSON mode; an answer that does not parse is repaired once (a fence, text around the object,
 * trailing commas) before it counts as a bad response.
 */
export async function chatJson<S extends z.ZodType>(
  schema: S,
  messages: Message[],
  maxTokens?: number,
  role: ModelRole = "deep",
) {
  const config = aiConfig();
  if (!config) throw new AiError("not_configured");
  const started = Date.now();
  const check = (value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { success: true as const, value: parsed.data as z.output<S> }
      : { success: false as const, error: parsed.error };
  };
  try {
    const result = await generateText({
      model: languageModel(config, role),
      messages: toModelMessages(messages),
      allowSystemInMessages: true,
      // JSON mode without a schema: the request stays the same for every compatible server, and
      // the schema checks the answer here (a transform, such as a cut to a limit, runs after it).
      output: Output.json(),
      maxOutputTokens: maxTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = check(result.output);
    if (!parsed.success) throw new AiError("bad_response");
    return {
      value: parsed.value,
      usage: usageOf(config.models[role], result.usage, started),
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.text) {
      const repaired = repairJson(error.text);
      const parsed = repaired === null ? null : check(JSON.parse(repaired));
      if (parsed?.success)
        return {
          value: parsed.value,
          usage: usageOf(config.models[role], error.usage, started),
        };
    }
    throw toAiError(error);
  }
}

/** Embeddings for up to 64 texts, in input order. */
export async function embed(
  texts: string[],
  timeoutMs = TIMEOUT_MS,
  configOverride?: AiConfig,
) {
  const config = configOverride ?? aiConfig();
  if (!config) throw new AiError("not_configured");
  if (!config.embeddingModel) throw new AiError("embeddings_not_configured");
  const started = Date.now();
  try {
    const result = await embedMany({
      model: embeddingModel({
        ...config,
        embeddingModel: config.embeddingModel,
      }),
      values: texts.map((text) => text.slice(0, 8000)),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    if (
      result.embeddings.length !== texts.length ||
      result.embeddings.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)
    )
      throw new AiError("bad_response");
    return {
      vectors: result.embeddings,
      usage: usageOf(
        config.embeddingModel,
        { inputTokens: result.usage.tokens, outputTokens: 0 },
        started,
      ),
    };
  } catch (error) {
    throw toAiError(error);
  }
}
