import { empty, fixture } from "../framework/contract";

const body = (value: object) =>
  fixture({ seed: async () => ({}), valid: () => ({ body: value }) });

export const getQuillsOfficeHours = empty;
export const setQuillsOfficeHours = body({
  enabled: true,
  timezone: "Europe/Berlin",
  intervals: [{ day: 1, start: "09:00", end: "17:00" }],
  holidays: [{ date: "2026-12-25", name: "Christmas", recurringAnnual: true }],
});
export const getQuillsConversationRouting = empty;
export const setQuillsConversationRouting = body({
  enabled: true,
  strategy: "auto_assign_active",
});
export const getQuillsEmailAutoAck = empty;
export const setQuillsEmailAutoAck = body({ enabled: true });
export const getQuillsAwayReply = empty;
export const setQuillsAwayReply = body({
  enabled: true,
  message: "We are away and will reply soon.",
});
export const getQuillsSpamFilterConfig = empty;
export const updateQuillsSpamFilterConfig = body({
  trustedSenders: ["Acme.com", "not an address"],
  aiClassifier: false,
});
export const getQuillsUndoSendSettings = empty;
export const setQuillsUndoSendSettings = body({
  enabled: true,
  delaySeconds: 15,
});
export const getQuillsReopenPolicy = empty;
export const setQuillsReopenPolicy = body({
  mode: "within_days",
  windowDays: 14,
  autoCloseAfterDays: 5,
  reminderBeforeCloseHours: 24,
});
export const getQuillsCsatSettings = empty;
export const setQuillsCsatSettings = body({
  enabled: true,
  samplingRate: 50,
  cooldownDays: 14,
  delayMinutes: 15,
  excludeTrivialUnderMessages: 2,
  lowScoreThreshold: 2,
  autoCreateFollowUpOnLow: true,
});
export const getQuillsEmailChannelStatus = empty;
