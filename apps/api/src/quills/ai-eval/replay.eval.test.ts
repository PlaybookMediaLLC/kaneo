import {
  buildHandoffSummary,
  DEFAULT_DECLINE_TOPICS,
  evaluateRetrievalGate,
  guardCustomerAgentReply,
  isExplicitHumanRequest,
  matchDeclineTopic,
  type GroundedSource,
} from "@quills/ai/customer-agent";
import { describe, expect, it } from "vite-plus/test";
import { runDeterministicPolicyEval } from "../assistant/guardrails";

/**
 * Deterministic offline replay evaluation suite for the AI customer agent (#299).
 * Runs on every PR touching `packages/quills-ai/**` or `apps/api/src/quills/assistant/**`
 * without requiring a live LLM API key, and blocks regressions in grounding, decline topics,
 * confidence thresholds, and deterministic escalation.
 */
describe("AI customer agent replay evaluation gate (#299)", () => {
  it("passes 100% of built-in deterministic grounding, escalation, and decline-topic cases", () => {
    const result = runDeterministicPolicyEval(DEFAULT_DECLINE_TOPICS);
    expect(result.passed).toBe(true);
    expect(result.groundingScore).toBe(1);
    expect(result.escalationScore).toBe(1);
    expect(result.declineScore).toBe(1);
    expect(result.passedCases).toBe(result.totalCases);
  });

  it("refuses answering from memory when retrieval returns zero qualifying sources", () => {
    const gate = evaluateRetrievalGate([
      {
        id: "article_low",
        type: "article",
        title: "Unrelated article",
        excerpt: "Keyboard shortcuts overview.",
        url: "/portal/acme/help/1-shortcuts",
        score: 0.12,
      },
    ]);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reason).toBe("no_supporting_source");
  });

  it("enforces always_handoff and quote_only across pricing, refunds, policies, and contract terms", () => {
    const prompts = [
      ["Can you give us a 40% discount on enterprise pricing?", "pricing"],
      ["I was double charged and want a refund.", "refunds"],
      ["Do you have a SOC 2 Type II report and GDPR DPA?", "policies"],
      ["Can we redline the liability cap in the MSA?", "contract_terms"],
    ] as const;

    for (const [text, expectedSlug] of prompts) {
      const match = matchDeclineTopic(text, DEFAULT_DECLINE_TOPICS);
      expect(match.matched).toBe(true);
      if (match.matched) {
        expect(match.topic.slug).toBe(expectedSlug);
        expect(match.topic.policy).toBe("quote_only");
      }
    }

    const pricingSource: GroundedSource = {
      id: "article_pricing",
      type: "article",
      title: "Plans & Pricing",
      excerpt: "The Pro plan costs $19 per seat per month billed annually.",
      url: "/portal/acme/help/2-pricing",
      score: 0.93,
    };
    const retrieved = new Map([[pricingSource.id, pricingSource]]);
    const match = matchDeclineTopic(
      "How much does it cost per seat?",
      DEFAULT_DECLINE_TOPICS,
    );

    // Paraphrasing must hand off
    const paraphrased = guardCustomerAgentReply({
      output: {
        reply: "It is around twenty dollars a month per user.",
        handoff: null,
        confidence: 0.95,
        quotedExcerpt: "around twenty dollars a month",
        sourceIds: [pricingSource.id],
      },
      retrievedSources: retrieved,
      declineMatch: match,
    });
    expect(paraphrased.outcome).toBe("handoff");

    // Verbatim quote + real URL citation passes
    const quoted = guardCustomerAgentReply({
      output: {
        reply:
          'From Plans & Pricing: "The Pro plan costs $19 per seat per month billed annually."',
        handoff: null,
        confidence: 0.95,
        quotedExcerpt:
          "The Pro plan costs $19 per seat per month billed annually.",
        sourceIds: [pricingSource.id],
      },
      retrievedSources: retrieved,
      declineMatch: match,
    });
    expect(quoted.outcome).toBe("answer");
    if (quoted.outcome === "answer") {
      expect(quoted.citations[0]?.url).toBe("/portal/acme/help/2-pricing");
    }
  });

  it("escalates immediately on explicit human request with structured handoff note", () => {
    expect(isExplicitHumanRequest("Talk to a person")).toBe(true);
    expect(isExplicitHumanRequest("Please connect me with a live agent")).toBe(
      true,
    );
    const { structured, note } = buildHandoffSummary({
      agentName: "Quinn",
      customerQuestion: "Talk to a person about my invoice",
      reason: "customer_requested",
      confidence: null,
      attemptedSteps: ["Customer requested human handoff"],
      sourcesConsulted: [],
    });
    expect(structured.reason).toBe("customer_requested");
    expect(note).toContain("Attempted steps:");
    expect(note).toContain("Customer requested human handoff");
  });
});
