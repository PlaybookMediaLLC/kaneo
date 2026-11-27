import { empty, fixture } from "../framework/contract";

export const getQuillsNotificationDefaults = empty;
export const setQuillsNotificationDefaults = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      digestFrequency: "daily",
      matrix: [{ type: "conversation_routed_team", inApp: true, email: false }],
    },
  }),
});
