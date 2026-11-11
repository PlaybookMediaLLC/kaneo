import { fixture } from "../framework/contract";
import { seed, seedFor, type Ids } from "./seed.fixture";

const onMacro = (
  extra: (ids: Ids) => object = () => ({}),
  more: (ids: Ids) => Record<string, string> = () => ({}),
) =>
  fixture({
    seed: seedFor("macro"),
    valid: (ids: Ids) => ({
      params: { macroId: ids.a.macroId },
      ...extra(ids),
    }),
    foreign: (ids: Ids) => ({ macroId: ids.b.macroId, ...more(ids) }),
  });

export const listQuillsMacros = fixture({
  seed,
  valid: () => ({ query: { surface: "support" } }),
});
export const createQuillsMacro = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      name: "Escalate",
      body: "Hi {firstName}, we escalated this.",
      actions: [
        { type: "assign_team", teamId: a.teamId },
        { type: "assign_agent", principalId: a.teammateId },
        { type: "set_attribute", key: "plan", value: ["pro", "trial"] },
      ],
    },
  }),
});
export const updateQuillsMacro = onMacro(() => ({
  body: { name: "Thanks again" },
}));
export const deleteQuillsMacro = onMacro();
export const applyQuillsMacro = onMacro(
  ({ a }) => ({ body: { conversationId: a.conversationId } }),
  ({ b }) => ({ conversationId: b.conversationId }),
);
