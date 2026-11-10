import { fixture } from "../framework/contract";
import { all, seed, seeded, type Ids } from "./seed.fixture";

const defined = seeded("attributes");

const onAttribute = (pick: (side: Ids["a"]) => string) =>
  fixture({
    seed: defined,
    valid: (ids: Ids) => ({ params: { attributeId: pick(ids.a) } }),
    foreign: (ids: Ids) => ({ attributeId: pick(ids.b) }),
  });
const active = onAttribute((side) => side.attributeId);

export const listQuillsConversationAttributes = all;
export const createQuillsConversationAttribute = fixture({
  seed,
  valid: (ids: Ids) => ({
    body: {
      key: ids.a.newAttributeKey,
      label: "Topic",
      fieldType: "select",
      options: [{ label: "Billing" }],
    },
  }),
});
export const updateQuillsConversationAttribute = fixture({
  ...active,
  valid: (ids: Ids) => ({ ...active.valid(ids), body: { label: "Renamed" } }),
});
export const archiveQuillsConversationAttribute = active;
export const restoreQuillsConversationAttribute = onAttribute(
  (side) => side.archivedAttributeId,
);
export const attributeQuillsValueCounts = active;
export const setQuillsConversationAttributeValue = fixture({
  seed: defined,
  valid: (ids: Ids) => ({
    params: { conversationId: ids.a.conversationId, key: ids.a.attributeKey },
    body: { value: "opt_billing" },
  }),
  // A key defined only in B is unknown in A.
  foreign: (ids: Ids) => ({
    conversationId: ids.b.conversationId,
    key: ids.b.attributeKey,
  }),
});
