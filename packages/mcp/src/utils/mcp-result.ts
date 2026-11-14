import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(data: unknown, isError = false): CallToolResult {
  const text =
    typeof data === "string" ? data : (JSON.stringify(data, null, 2) ?? "");
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError,
  };
}

export function errorResult(message: string): CallToolResult {
  return textResult({ error: message }, true);
}

/** Runs one tool call: its data as text, or its error message as an error result. */
export function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  return fn()
    .then((data) => textResult(data))
    .catch((e: unknown) =>
      errorResult(e instanceof Error ? e.message : String(e)),
    );
}
