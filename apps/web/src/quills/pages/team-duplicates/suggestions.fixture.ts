import type { ListMergeSuggestionsResponse } from "../../api/team/list-merge-suggestions";

type Suggestion = ListMergeSuggestionsResponse["items"][number];

/** The test pairs of the duplicates page. The default pair is pending. */
export const suggestionsFixture = {
  suggestion: (overrides: Partial<Suggestion> = {}): Suggestion => ({
    id: "suggestion_test_1",
    status: "pending",
    source: {
      id: "post_test_1",
      title: "Dark theme",
      voteCount: 2,
      boardName: "Ideas",
      statusName: null,
    },
    target: {
      id: "post_test_2",
      title: "Dark mode",
      voteCount: 9,
      boardName: "Ideas",
      statusName: "Planned",
    },
    hybridScore: 0.93,
    llmConfidence: 0.9,
    llmReasoning: "Both ask for a dark color scheme.",
    createdAt: "2026-11-01T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  }),
  list: (items: Suggestion[]) =>
    ({ items, nextOffset: null }) satisfies ListMergeSuggestionsResponse,
};
