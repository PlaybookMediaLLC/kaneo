import { fixture } from "../framework/contract";

process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-contract-test-key";

export const getQuillsAssistantBudget = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const updateQuillsAssistantBudget = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      dailyCapUsd: 10,
      monthlyCapUsd: 100,
      alertThresholdPercent: 80,
      degradeBehavior: "draft_mode" as const,
    },
  }),
});

export const setQuillsAssistantProviderKeys = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-contract-key-123456",
      chatModel: "gpt-4o-mini",
    },
  }),
});

export const deleteQuillsAssistantProviderKeys = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});
