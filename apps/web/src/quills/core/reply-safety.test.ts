import { describe, expect, it } from "vite-plus/test";
import {
  detectInternalContentInReply,
  extractMentionedPrincipalIds,
} from "./reply-safety";

const TEAM = [
  { id: "pr_1", displayName: "Alice Johnson", email: "alice@company.test" },
  { id: "pr_2", displayName: "Bob Chen", email: "bchen@company.test" },
];

describe("detectInternalContentInReply", () => {
  it("flags @mentions of teammates and teams in reply mode", () => {
    expect(
      detectInternalContentInReply("Hey @alice can you check Stripe?", TEAM),
    ).toEqual({
      flagged: true,
      reason: "mention",
      matchedMentions: ["@alice"],
    });
    expect(
      detectInternalContentInReply(
        "@engineering looks like a regression",
        TEAM,
      ),
    ).toEqual({
      flagged: true,
      reason: "mention",
      matchedMentions: ["@engineering"],
    });
  });

  it("does not flag normal customer email addresses", () => {
    expect(
      detectInternalContentInReply(
        "Please send the invoice to billing@customer.io and we will update it.",
        TEAM,
      ),
    ).toEqual({
      flagged: false,
      reason: null,
      matchedMentions: [],
    });
  });

  it("flags obvious internal-only phrases", () => {
    expect(
      detectInternalContentInReply(
        "Internal note: do not share with customer until legal signs off.",
        TEAM,
      ),
    ).toEqual({
      flagged: true,
      reason: "internal_phrase",
      matchedMentions: [],
    });
  });
});

describe("extractMentionedPrincipalIds", () => {
  it("maps teammate @mentions to unique principal IDs", () => {
    expect(
      extractMentionedPrincipalIds(
        "Looping in @alice, @bchen and @alice again",
        TEAM,
      ),
    ).toEqual(["pr_1", "pr_2"]);
  });

  it("ignores unknown handles and email addresses", () => {
    expect(
      extractMentionedPrincipalIds(
        "Contact support@company.test or @nobody",
        TEAM,
      ),
    ).toEqual([]);
  });
});
