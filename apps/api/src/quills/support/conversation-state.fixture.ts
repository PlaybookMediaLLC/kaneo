import { fixture } from "../framework/contract";
import { onConversation, seeded, type Ids } from "./conversation-seed.fixture";

const spam = fixture({
  seed: seeded("spam"),
  valid: (ids: Ids) => ({ params: { conversationId: ids.a.spamId } }),
  foreign: (ids: Ids) => ({ conversationId: ids.b.spamId }),
});

const archived = fixture({
  seed: seeded("archived"),
  valid: (ids: Ids) => ({ params: { conversationId: ids.a.archivedId } }),
  foreign: (ids: Ids) => ({ conversationId: ids.b.archivedId }),
});

export const setQuillsConversationStatus = onConversation(() => ({
  body: { status: "closed" },
}));
export const snoozeQuillsConversation = onConversation(() => ({
  body: { until: new Date(Date.now() + 86400000).toISOString() },
}));
export const endQuillsConversation = onConversation(() => ({
  body: { reason: "resolved", note: "Answered" },
}));
export const restoreQuillsConversationFromSpam = spam;
export const archiveQuillsConversation = onConversation();
export const unarchiveQuillsConversation = archived;
export const setQuillsConversationPriority = onConversation(() => ({
  body: { priority: "high" },
}));
export const assignQuillsConversation = onConversation(
  (ids) => ({ body: { assigneePrincipalId: ids.a.teammateId } }),
  (ids) => ({ assigneePrincipalId: ids.b.teammateId }),
);
export const assignQuillsConversationTeam = onConversation(
  (ids) => ({ body: { teamId: ids.a.teamId } }),
  (ids) => ({ teamId: ids.b.teamId }),
  ["team"],
);
export const captureQuillsVisitorContactEmail = onConversation(() => ({
  body: { email: "visitor@example.test" },
}));
export const setQuillsInboxTranslationEnabled = onConversation(() => ({
  body: { enabled: true },
}));
export const dismissQuillsInboxTranslationSuggestion = onConversation();
export const setQuillsAgentAvailability = fixture({
  seed: seeded("own"),
  valid: () => ({ body: { availability: "away" } }),
});
export const setQuillsConversationRequester = onConversation(() => ({
  body: { email: "real-customer@example.test", name: "Real Customer" },
}));
export const offerQuillsConversationSolution = onConversation(() => ({
  body: { autoCloseAfterDays: 5 },
}));
