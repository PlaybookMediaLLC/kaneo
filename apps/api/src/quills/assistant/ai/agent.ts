// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import type { ModelRole } from "@quills/ai/capability";
import {
  generateText,
  InvalidToolInputError,
  NoObjectGeneratedError,
  Output,
  jsonSchema,
  stepCountIs,
  tool,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { usageOf } from "./calls";
import { aiConfig } from "./config";
import { AiError, toAiError } from "./errors";
import { toModelMessages } from "./messages";
import { languageModel } from "./registry";
import type { Message, Usage } from "./types";

const DENIED = "Denied: this tool is not available.";

/** A tool error the SDK wrote for a call to a tool that was not offered, in our words. */
const denyUnknown =
  (offered: ReadonlySet<string>) =>
  (message: ModelMessage): ModelMessage =>
    message.role !== "tool"
      ? message
      : {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-result" &&
            part.output.type.startsWith("error") &&
            !offered.has(part.toolName)
              ? { ...part, output: { type: "text" as const, value: DENIED } }
              : part,
          ),
        };

/** A tool as the loop sees it: what the model reads, and the handler that answers one call. */
export type LoopTool = {
  name: string;
  description: string;
  /** The JSON schema of the arguments. */
  parameters: object;
  /** Answers one call with text for the model. It validates, checks permissions and audits. */
  run: (args: unknown) => Promise<string>;
};

/**
 * The tool loop on the AI SDK: at most `maxSteps` model calls, the last one without tools, so the
 * model must answer. Calls run one at a time, at most `maxCallsPerStep` in a step. A call to a tool
 * that was not offered never runs; `onDenied` records it. Each step's usage goes to `onStep` at
 * once, so a later failure keeps it. A handler's own error is a bug: the loop stops after that
 * step, before any further model call, so the error text never reaches the provider, and the turn
 * fails. Each model call has `stepTimeoutMs`, and the whole turn `timeoutMs`.
 */
export async function runToolLoop(input: {
  role?: ModelRole;
  messages: Message[];
  tools: LoopTool[];
  maxSteps: number;
  maxCallsPerStep: number;
  maxOutputTokens: number;
  timeoutMs: number;
  stepTimeoutMs: number;
  /** The final answer is a JSON object (JSON mode); the caller checks it against its schema. */
  json?: boolean;
  /** Max concurrent tool calls in one step; defaults to 1 (sequential for write-capable loops). */
  toolCallConcurrency?: number;
  onStep: (usage: Usage) => void;
  onDenied: (name: string, args: unknown) => void;
}): Promise<string | null> {
  const config = aiConfig();
  if (!config) throw new AiError("not_configured");
  const role = input.role ?? "deep";
  let calls = 0;
  let step = 0;
  let stepStarted = Date.now();
  let failure: unknown;
  const deny = denyUnknown(new Set(input.tools.map((item) => item.name)));
  const tools: ToolSet = Object.fromEntries(
    input.tools.map((item) => [
      item.name,
      tool({
        description: item.description,
        inputSchema: jsonSchema<Record<string, unknown>>(
          item.parameters as Parameters<typeof jsonSchema>[0],
        ),
        execute: async (args: unknown) => {
          if (failure !== undefined) return "Skipped: the turn stopped.";
          if (++calls > input.maxCallsPerStep)
            return `Skipped: at most ${input.maxCallsPerStep} tool calls in one step.`;
          try {
            return await item.run(args);
          } catch (error) {
            failure ??= error;
            throw error;
          }
        },
      }),
    ]),
  );
  try {
    const result = await generateText({
      model: languageModel(config, role),
      messages: toModelMessages(input.messages),
      allowSystemInMessages: true,
      ...(input.tools.length && { tools }),
      ...(input.json && { output: Output.json() }),
      // A handler error ends the loop before the next model call sees it.
      stopWhen: [stepCountIs(input.maxSteps), () => failure !== undefined],
      toolCallConcurrency: input.toolCallConcurrency ?? 1,
      prepareStep: ({ stepNumber, messages }) => {
        if (failure !== undefined) throw failure;
        calls = 0;
        step = stepNumber;
        stepStarted = Date.now();
        return {
          ...(stepNumber === input.maxSteps - 1 && { activeTools: [] }),
          messages: messages.map(deny),
        };
      },
      // Arguments that are not JSON reach the handler as null, so it answers in its own words and
      // records the call; the raw text never goes back to the model.
      repairToolCall: async ({ toolCall, error }) =>
        InvalidToolInputError.isInstance(error)
          ? { ...toolCall, input: "null" }
          : null,
      onStepFinish: (done) => {
        input.onStep(usageOf(config.models[role], done.usage, stepStarted));
        // On the last step no tool is offered, so a call there is ignored, not denied.
        if (step < input.maxSteps - 1)
          for (const part of done.content)
            if (part.type === "tool-call" && part.invalid)
              input.onDenied(part.toolName, part.input);
      },
      maxOutputTokens: input.maxOutputTokens,
      // The job retries; a retry inside the loop would repeat tool calls.
      maxRetries: 0,
      timeout: { totalMs: input.timeoutMs, stepMs: input.stepTimeoutMs },
    });
    if (failure) throw failure;
    return result.text.trim() || null;
  } catch (error) {
    // An answer that is not JSON goes back as text, so the caller can repair it once.
    if (
      !failure &&
      input.json &&
      NoObjectGeneratedError.isInstance(error) &&
      error.text
    )
      return error.text;
    throw toAiError(failure ?? error);
  }
}
