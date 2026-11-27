import { describe, expect, it } from "vite-plus/test";
import {
  buildHandoffSummary,
  DEFAULT_DECLINE_TOPICS,
  evaluateRetrievalGate,
  guardCustomerAgentReply,
  isExplicitHumanRequest,
  matchDeclineTopic,
  verifyQuoteOnlyAnswer,
  type GroundedSource,
} from "./index";

const sampleSource: GroundedSource = {
  id: "article_01test",
  type: "article",
  title: "Refund policy",
  excerpt:
    "Full refunds are available within 14 days of your initial subscription purchase when requested via support.",
  url: "/portal/acme/help/refund-policy",
  score: 0.88,
};

describe("customer-agent pure guardrails (#299)", () => {
  it("blocks answering when zero sources meet the retrieval relevance floor", () => {
    expect(evaluateRetrievalGate([])).toEqual({
      allowed: false,
      reason: "no_supporting_source",
      qualifyingSources: [],
    });
    expect(
      evaluateRetrievalGate([{ ...sampleSource, score: 0.12 }], 0.35),
    ).toEqual({
      allowed: false,
      reason: "no_supporting_source",
      qualifyingSources: [],
    });
    const ok = evaluateRetrievalGate([sampleSource], 0.35);
    expect(ok.allowed).toBe(true);
    expect(ok.qualifyingSources).toHaveLength(1);
  });

  it("matches default decline topics and prioritizes always_handoff over quote_only", () => {
    const match = matchDeclineTopic(
      "Can I get a refund for my invoice?",
      DEFAULT_DECLINE_TOPICS,
    );
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.topic.slug).toBe("refunds");
      expect(match.topic.policy).toBe("quote_only");
    }

    const custom = [
      ...DEFAULT_DECLINE_TOPICS,
      {
        slug: "legal_threats",
        label: "Legal threats",
        policy: "always_handoff" as const,
        examples: ["lawsuit", "attorney"],
        enabled: true,
      },
    ];
    const escalate = matchDeclineTopic(
      "My attorney wants a refund or we will file a lawsuit",
      custom,
    );
    expect(escalate.matched).toBe(true);
    if (escalate.matched) {
      expect(escalate.topic.policy).toBe("always_handoff");
    }
  });

  it("rejects replies with missing/fabricated citations, low confidence, or missing verbatim quote on quote_only topics", () => {
    const retrieved = new Map([[sampleSource.id, sampleSource]]);

    // Missing citation -> handoff
    const noCite = guardCustomerAgentReply({
      output: {
        reply: "You can get a refund anytime.",
        handoff: null,
        confidence: 0.95,
        sourceIds: ["article_fabricated"],
      },
      retrievedSources: retrieved,
    });
    expect(noCite.outcome).toBe("handoff");
    if (noCite.outcome === "handoff") {
      expect(noCite.guardTriggered).toBe("missing_citation");
    }

    // Low confidence -> handoff
    const lowConf = guardCustomerAgentReply({
      output: {
        reply: "Maybe 14 days.",
        handoff: null,
        confidence: 0.42,
        sourceIds: [sampleSource.id],
      },
      retrievedSources: retrieved,
      confidenceThreshold: 0.75,
    });
    expect(lowConf.outcome).toBe("handoff");
    if (lowConf.outcome === "handoff") {
      expect(lowConf.guardTriggered).toBe("low_confidence");
    }

    // Quote-only topic without verbatim quote -> handoff
    const declineMatch = matchDeclineTopic(
      "What is your refund policy?",
      DEFAULT_DECLINE_TOPICS,
    );
    const paraphrased = guardCustomerAgentReply({
      output: {
        reply: "We usually give refunds in two weeks.",
        handoff: null,
        confidence: 0.92,
        quotedExcerpt: "We usually refund within two weeks",
        sourceIds: [sampleSource.id],
      },
      retrievedSources: retrieved,
      declineMatch,
    });
    expect(paraphrased.outcome).toBe("handoff");
    if (paraphrased.outcome === "handoff") {
      expect(paraphrased.guardTriggered).toBe("decline_quote_missing");
    }

    // Quote-only topic WITH verbatim quote + citation + high confidence -> answer!
    const grounded = guardCustomerAgentReply({
      output: {
        reply:
          'According to our Refund policy: "Full refunds are available within 14 days of your initial subscription purchase."',
        handoff: null,
        confidence: 0.92,
        quotedExcerpt:
          "Full refunds are available within 14 days of your initial subscription purchase",
        sourceIds: [sampleSource.id],
      },
      retrievedSources: retrieved,
      declineMatch,
    });
    expect(grounded.outcome).toBe("answer");
    if (grounded.outcome === "answer") {
      expect(grounded.citations).toEqual([
        {
          type: "article",
          id: sampleSource.id,
          title: sampleSource.title,
          url: sampleSource.url,
        },
      ]);
    }
  });

  it("verifies verbatim quote matching and builds structured handoff notes", () => {
    expect(verifyQuoteOnlyAnswer("too short", [sampleSource]).ok).toBe(false);
    expect(
      verifyQuoteOnlyAnswer("Full refunds are available within 14 days", [
        sampleSource,
      ]).ok,
    ).toBe(true);

    expect(isExplicitHumanRequest("Can I talk to a person please?")).toBe(true);
    expect(isExplicitHumanRequest("How do I reset my password?")).toBe(false);

    const { structured, note } = buildHandoffSummary({
      agentName: "Quinn",
      customerQuestion: "Can you customize our enterprise MSA?",
      reason: "restricted_topic",
      confidence: 0.31,
      attemptedSteps: ["Matched decline topic: Legal & contract terms"],
      sourcesConsulted: [
        {
          id: sampleSource.id,
          title: sampleSource.title,
          url: sampleSource.url,
        },
      ],
    });
    expect(structured.reason).toBe("restricted_topic");
    expect(structured.confidence).toBe(0.31);
    expect(note).toContain("Attempted steps:");
    expect(note).toContain("Sources consulted:");
    expect(note).toContain(sampleSource.url);
  });
});
