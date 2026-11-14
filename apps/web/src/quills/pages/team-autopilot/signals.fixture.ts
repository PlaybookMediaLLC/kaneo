import type { ListFeedbackSignalsResponse } from "../../api/team/list-feedback-signals";

type Signal = ListFeedbackSignalsResponse["items"][number];

const post = {
  id: "post_test_1",
  title: "Dark mode",
  voteCount: 1,
  boardName: "Ideas",
  statusName: null,
};

/** The test signals of the autopilot page. The default signal is pending and matches a post. */
export const signalsFixture = {
  post,
  signal: (overrides: Partial<Signal> = {}): Signal => ({
    id: "feedback_signal_test_1",
    status: "pending",
    source: {
      type: "conversation",
      id: "conversation_test_1",
      title: "Night use",
      number: null,
    },
    customer: { principalId: "principal_test_1", displayName: "Ada" },
    excerpt: "Please add a dark mode.",
    suggestedTitle: "Dark theme",
    matchedPost: post,
    resultingPost: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    decidedAt: null,
    ...overrides,
  }),
  list: (items: Signal[]) =>
    ({ items, nextOffset: null }) satisfies ListFeedbackSignalsResponse,
};
