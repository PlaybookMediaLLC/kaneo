import type { ConfirmFeedbackCardResponse } from "./confirm-feedback-card";
export const confirmFeedbackCardFixture = {
  ok: (overrides: Partial<ConfirmFeedbackCardResponse> = {}) =>
    ({
      ...{
        message: {
          id: "id_test_1",
          conversationId: "conversation_id_test_1",
          fromVisitor: false,
          senderType: "visitor",
          author: null,
          content: "value",
          embeds: [],
          attachments: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          editedAt: null,
          fromAssistant: false,
          feedbackCard: null,
          citations: [],
        },
      },
      ...overrides,
    }) satisfies ConfirmFeedbackCardResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
