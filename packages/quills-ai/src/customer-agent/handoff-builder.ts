export type HandoffSummary = {
  summary: string;
  attemptedSteps: string[];
  sourcesConsulted: Array<{ id: string; title: string; url: string }>;
  reason: string;
  confidence: number | null;
};

/**
 * Builds a structured handoff summary object and formats a teammate-facing internal note (#299).
 * Ensures teammates receive actionable context (customer question, what the agent checked,
 * consulted sources, reason, and confidence) instead of a bare 1-sentence stub.
 */
export function buildHandoffSummary(input: {
  agentName: string;
  customerQuestion: string;
  reason: string;
  confidence?: number | null;
  attemptedSteps: readonly string[];
  sourcesConsulted: ReadonlyArray<{ id: string; title: string; url: string }>;
}): { structured: HandoffSummary; note: string } {
  const cleanQuestion = input.customerQuestion.trim().slice(0, 500);
  const structured: HandoffSummary = {
    summary: cleanQuestion,
    attemptedSteps: input.attemptedSteps
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8),
    sourcesConsulted: input.sourcesConsulted.slice(0, 8).map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
    })),
    reason: input.reason,
    confidence:
      typeof input.confidence === "number"
        ? Math.round(input.confidence * 100) / 100
        : null,
  };

  const lines: string[] = [
    `${input.agentName} handed this conversation to the team.`,
    `Reason: ${input.reason.replace(/_/g, " ")}${structured.confidence !== null ? ` (confidence ${Math.round(structured.confidence * 100)}%)` : ""}`,
    `Customer asked: "${cleanQuestion}"`,
  ];

  if (structured.attemptedSteps.length > 0) {
    lines.push(
      `Attempted steps:\n${structured.attemptedSteps.map((s) => `- ${s}`).join("\n")}`,
    );
  }

  if (structured.sourcesConsulted.length > 0) {
    lines.push(
      `Sources consulted:\n${structured.sourcesConsulted.map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ""}`).join("\n")}`,
    );
  } else {
    lines.push("Sources consulted: none matched.");
  }

  return { structured, note: lines.join("\n\n") };
}

/**
 * Detects explicit customer requests to speak to a human without spending an LLM call.
 */
export function isExplicitHumanRequest(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const patterns = [
    /\btalk to (a |an )?(human|person|agent|representative|someone)\b/,
    /\bspeak (to|with) (a |an )?(human|person|agent|representative|someone)\b/,
    /\bconnect me (to|with) (a |an )?(human|person|agent|support|team)\b/,
    /\breal person\b/,
    /\bhuman agent\b/,
    /\blive agent\b/,
  ];
  return patterns.some((re) => re.test(normalized));
}
