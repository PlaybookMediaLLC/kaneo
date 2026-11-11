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
export const getQuillsSpamFilterConfig = empty;
export const updateQuillsSpamFilterConfig = body({
  trustedSenders: ["Acme.com", "not an address"],
  aiClassifier: false,
});
