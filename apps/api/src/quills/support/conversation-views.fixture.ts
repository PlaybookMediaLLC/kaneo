import { fixture } from "../framework/contract";
import { all, seeded, type Ids } from "./conversation-seed.fixture";

const onView = fixture({
  seed: seeded("view"),
  valid: (ids: Ids) => ({ params: { viewId: ids.a.viewId } }),
  foreign: (ids: Ids) => ({ viewId: ids.b.viewId }),
});

export const listQuillsConversationViews = all;
export const createQuillsConversationView = fixture({
  seed: seeded("tags"),
  valid: (ids: Ids) => ({
    body: {
      name: ids.a.viewName,
      filters: { rules: [{ field: "tag", value: ids.a.tagId }] },
      sort: "waiting",
    },
  }),
});
export const updateQuillsConversationView = fixture({
  ...onView,
  valid: (ids: Ids) => ({
    ...onView.valid(ids),
    body: { name: ids.a.viewName },
  }),
});
export const deleteQuillsConversationView = onView;
export const pinQuillsConversationView = onView;
export const unpinQuillsConversationView = onView;
