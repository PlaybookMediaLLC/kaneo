import type { GroundedSource } from "./retrieval-gate.js";
import { verifyQuoteOnlyAnswer, type DeclineMatch } from "./decline-policy.js";

export type AgentModelOutput = {
  reply: string;
  handoff: string | null;
  confidence: number;
  quotedExcerpt?: string | null;
  sourceIds: readonly string[];
};

export type GroundedCitation = {
  type: GroundedSource["type"];
  id: string;
  title: string;
  url: string;
};

export type GuardResult =
  | {
      outcome: "answer";
      reply: string;
      citations: GroundedCitation[];
      confidence: number;
    }
  | {
      outcome: "handoff";
      reply: string;
      handoffReason: string;
      citations: GroundedCitation[];
      confidence: number;
      guardTriggered:
        | "model_requested"
        | "missing_citation"
        | "low_confidence"
        | "decline_quote_missing"
        | "empty_reply";
    };

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
export const DEFAULT_HANDOFF_REPLY =
  "I want to make sure you get an accurate answer, so I've connected you with our team.";

/**
 * Post-LLM citation, confidence, and quote-only guard (#299).
 * Guarantees that NO customer reply ever ships without at least one verified citation from the
 * retrieved source set, meeting the confidence threshold, and honoring quote-only topic rules.
 */
export function guardCustomerAgentReply(input: {
  output: AgentModelOutput;
  retrievedSources: ReadonlyMap<string, GroundedSource>;
  confidenceThreshold?: number;
  declineMatch?: DeclineMatch;
}): GuardResult {
  const threshold = input.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const seenIds = new Set<string>();
  const citations: GroundedCitation[] = [];
  const citedSources: GroundedSource[] = [];

  for (const id of input.output.sourceIds) {
    if (seenIds.has(id)) continue;
    const source = input.retrievedSources.get(id);
    if (!source) continue;
    seenIds.add(id);
    citedSources.push(source);
    citations.push({
      type: source.type,
      id: source.id,
      title: source.title,
      url: source.url,
    });
  }

  const trimmedReply = input.output.reply.trim();
  const confidence = Number.isFinite(input.output.confidence)
    ? Math.max(0, Math.min(1, input.output.confidence))
    : 0;

  if (input.output.handoff) {
    return {
      outcome: "handoff",
      reply: trimmedReply || DEFAULT_HANDOFF_REPLY,
      handoffReason: input.output.handoff,
      citations,
      confidence,
      guardTriggered: "model_requested",
    };
  }

  if (!trimmedReply) {
    return {
      outcome: "handoff",
      reply: DEFAULT_HANDOFF_REPLY,
      handoffReason: "cannot_answer",
      citations,
      confidence,
      guardTriggered: "empty_reply",
    };
  }

  if (citations.length === 0) {
    return {
      outcome: "handoff",
      reply: DEFAULT_HANDOFF_REPLY,
      handoffReason: "cannot_answer",
      citations: [],
      confidence,
      guardTriggered: "missing_citation",
    };
  }

  if (confidence < threshold) {
    return {
      outcome: "handoff",
      reply: DEFAULT_HANDOFF_REPLY,
      handoffReason: "low_confidence",
      citations,
      confidence,
      guardTriggered: "low_confidence",
    };
  }

  if (
    input.declineMatch?.matched &&
    input.declineMatch.topic.policy === "quote_only"
  ) {
    const quoteCheck = verifyQuoteOnlyAnswer(
      input.output.quotedExcerpt,
      citedSources,
    );
    if (!quoteCheck.ok) {
      return {
        outcome: "handoff",
        reply: DEFAULT_HANDOFF_REPLY,
        handoffReason: "restricted_topic",
        citations,
        confidence,
        guardTriggered: "decline_quote_missing",
      };
    }
  }

  return {
    outcome: "answer",
    reply: trimmedReply,
    citations,
    confidence,
  };
}
