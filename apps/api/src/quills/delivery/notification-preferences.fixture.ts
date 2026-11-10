import { empty, fixture } from "../framework/contract";

export const getQuillsNotificationPreferences = empty;
export const updateQuillsNotificationPreferences = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { emailMuted: true } }),
});
