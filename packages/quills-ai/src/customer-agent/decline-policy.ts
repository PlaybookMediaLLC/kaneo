import type { GroundedSource } from "./retrieval-gate.js";

export type DeclinePolicyMode = "quote_only" | "always_handoff";

export type DeclineTopicRule = {
  slug: string;
  label: string;
  policy: DeclinePolicyMode;
  examples: readonly string[];
  enabled: boolean;
};

export type DeclineMatch =
  | { matched: false }
  | {
      matched: true;
      topic: DeclineTopicRule;
      matchedTerm: string;
    };

export const DEFAULT_DECLINE_TOPICS: readonly DeclineTopicRule[] = [
  {
    slug: "pricing",
    label: "Pricing & custom quotes",
    policy: "quote_only",
    examples: [
      "pricing",
      "price",
      "discount",
      "enterprise quote",
      "custom plan",
      "how much does it cost",
      "per seat",
    ],
    enabled: true,
  },
  {
    slug: "refunds",
    label: "Refunds & billing disputes",
    policy: "quote_only",
    examples: [
      "refund",
      "chargeback",
      "money back",
      "cancel and refund",
      "billing dispute",
      "double charged",
    ],
    enabled: true,
  },
  {
    slug: "policies",
    label: "Security, privacy & compliance policies",
    policy: "quote_only",
    examples: [
      "gdpr",
      "hipaa",
      "soc 2",
      "soc2",
      "privacy policy",
      "data processing agreement",
      "dpa",
      "subprocessor",
    ],
    enabled: true,
  },
  {
    slug: "contract_terms",
    label: "Legal & contract terms",
    policy: "quote_only",
    examples: [
      "sla guarantee",
      "indemnification",
      "liability cap",
      "terms of service",
      "msa",
      "master services agreement",
      "redline",
    ],
    enabled: true,
  },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Matches a customer turn against enabled workspace decline topics (#299).
 * `always_handoff` topics take precedence over `quote_only` topics when both match.
 */
export function matchDeclineTopic(
  message: string,
  topics: readonly DeclineTopicRule[],
): DeclineMatch {
  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return { matched: false };
  const padded = ` ${normalizedMessage} `;

  const enabled = topics.filter((t) => t.enabled);
  const ordered = [
    ...enabled.filter((t) => t.policy === "always_handoff"),
    ...enabled.filter((t) => t.policy === "quote_only"),
  ];

  for (const topic of ordered) {
    const terms = [topic.slug.replace(/_/g, " "), ...topic.examples];
    for (const rawTerm of terms) {
      const term = normalize(rawTerm);
      if (term.length < 3) continue;
      if (padded.includes(` ${term} `)) {
        return { matched: true, topic, matchedTerm: rawTerm };
      }
    }
  }
  return { matched: false };
}

/**
 * For `quote_only` topics, verifies that the model supplied a verbatim excerpt actually present
 * in one of the cited sources (case/whitespace normalized) so the agent cannot paraphrase or
 * extrapolate pricing, refunds, policies, or contract terms.
 */
export function verifyQuoteOnlyAnswer(
  quotedExcerpt: string | null | undefined,
  citedSources: readonly GroundedSource[],
):
  | { ok: true; quote: string }
  | { ok: false; reason: "missing_verbatim_quote" } {
  const quote = quotedExcerpt?.trim() ?? "";
  const normalizedQuote = normalize(quote);
  if (normalizedQuote.length < 12) {
    return { ok: false, reason: "missing_verbatim_quote" };
  }
  const found = citedSources.some((source) =>
    normalize(source.excerpt).includes(normalizedQuote),
  );
  if (!found) {
    return { ok: false, reason: "missing_verbatim_quote" };
  }
  return { ok: true, quote };
}
