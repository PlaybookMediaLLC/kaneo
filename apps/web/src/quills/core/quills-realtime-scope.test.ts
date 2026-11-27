import { describe, expect, it } from "vite-plus/test";
import {
  affectsQuillsLinks,
  matchesQuillsEntityChange,
  needsFullQuillsInvalidation,
} from "./quills-realtime-scope";

describe("quills realtime invalidation scoping", () => {
  it("falls back to full invalidation when entityType is omitted or broad", () => {
    expect(needsFullQuillsInvalidation(new Set([null]))).toBe(true);
    expect(needsFullQuillsInvalidation(new Set(["settings"]))).toBe(true);
    expect(needsFullQuillsInvalidation(new Set(["conversation"]))).toBe(false);
    expect(
      needsFullQuillsInvalidation(
        new Set([
          "comment",
          "tag",
          "merge_suggestion",
          "changelog",
          "article",
          "status_group",
        ]),
      ),
    ).toBe(false);
  });

  it("matches link-affecting entity types for quills-links invalidation", () => {
    expect(affectsQuillsLinks(new Set(["post"]))).toBe(true);
    expect(affectsQuillsLinks(new Set(["board"]))).toBe(true);
    expect(affectsQuillsLinks(new Set(["ticket"]))).toBe(true);
    expect(affectsQuillsLinks(new Set(["conversation_message"]))).toBe(false);
    expect(affectsQuillsLinks(new Set(["article"]))).toBe(false);
  });

  it("scopes real outbox entity types to their matching operations", () => {
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "team", "listMergeSuggestions", null],
        "ws1",
        "u1",
        new Set(["merge_suggestion"]),
      ),
    ).toBe(true);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "help-center", "listArticles", null],
        "ws1",
        "u1",
        new Set(["article"]),
      ),
    ).toBe(true);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "team", "listPosts", null],
        "ws1",
        "u1",
        new Set(["article"]),
      ),
    ).toBe(false);
  });

  it("scopes conversation events without invalidating unrelated feedback or settings queries", () => {
    const entities = new Set<string | null>(["conversation_message"]);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "team", "listConversationMessages", null],
        "ws1",
        "u1",
        entities,
      ),
    ).toBe(true);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "team", "getTeamCounts", null],
        "ws1",
        "u1",
        entities,
      ),
    ).toBe(true);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "team", "listPosts", null],
        "ws1",
        "u1",
        entities,
      ),
    ).toBe(false);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws1", "u1", "team", "listPrincipals", null],
        "ws1",
        "u1",
        entities,
      ),
    ).toBe(false);
    expect(
      matchesQuillsEntityChange(
        ["quills", "ws2", "u1", "team", "listConversationMessages", null],
        "ws1",
        "u1",
        entities,
      ),
    ).toBe(false);
  });
});
