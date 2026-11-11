import { settings } from "../../database/quills/schema/auth";
import { empty, fixture } from "../framework/contract";

export const getQuillsAssistantSettings = empty;
export const updateQuillsAssistantSettings = fixture({
  // The revision the caller read: each check reads the current one.
  seed: async (env) => {
    const [row] = await env.scoped(env.a, (db) =>
      db.select({ revision: settings.assistantConfigRevision }).from(settings),
    );
    return { revision: row!.revision };
  },
  valid: ({ revision }) => ({
    body: {
      revision,
      name: "Quinn",
      copilotQa: true,
      copilotToolRules: [{ tool: "set_conversation_status", mode: "off" }],
    },
  }),
});
