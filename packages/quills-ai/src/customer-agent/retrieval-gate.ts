export type GroundedSource = {
  id: string;
  type: "article" | "snippet" | "document" | "webpage";
  title: string;
  excerpt: string;
  url: string;
  /** Optional cosine similarity or normalized lexical relevance in [0, 1]. */
  score?: number;
};

export type RetrievalGateDecision =
  | { allowed: true; qualifyingSources: GroundedSource[] }
  | { allowed: false; reason: "no_supporting_source"; qualifyingSources: [] };

export const DEFAULT_MIN_SOURCE_SCORE = 0.35;

/**
 * Hard retrieval gate before calling the LLM (#299).
 * If zero retrieved sources meet the relevance floor, the agent MUST hand off instead of
 * answering from model memory.
 */
export function evaluateRetrievalGate(
  sources: readonly GroundedSource[],
  minScore = DEFAULT_MIN_SOURCE_SCORE,
): RetrievalGateDecision {
  const qualifyingSources = sources.filter((source) => {
    if (!source.excerpt.trim()) return false;
    if (typeof source.score === "number" && source.score < minScore) {
      return false;
    }
    return true;
  });

  if (qualifyingSources.length === 0) {
    return {
      allowed: false,
      reason: "no_supporting_source",
      qualifyingSources: [],
    };
  }
  return { allowed: true, qualifyingSources };
}
