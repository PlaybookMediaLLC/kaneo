import { apiRouter, z } from "../../openapi";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  liveToken,
  spendToken,
  UNSUBSCRIBE_ACTIONS,
} from "./unsubscribe-token";

// Emailed unsubscribe links (public, the token is the only credential). These routes do not
// depend on the portal switch: teammates receive the same mail, and an unsubscribe link must keep
// working. A token that is unknown, spent, expired or malformed changes nothing.

const token = z.string().min(20).max(200);
const action = z.enum(UNSUBSCRIBE_ACTIONS).nullable();
const outcome = z.object({
  processed: z.boolean(),
  action,
  postTitle: z.string().nullable(),
});
const personal = {
  none: "The recipient's own subscription; the spent token row records the change.",
};

async function unsubscribe(db: Database, raw: string) {
  const row = await liveToken(db, raw, true);
  if (!row) return { processed: false, action: null, postTitle: null };
  await spendToken(db, row);
  return { processed: true, action: row.action, postTitle: row.postTitle };
}

const preview = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/unsubscribe",
  operationId: "previewQuillsUnsubscribeToken",
  summary: "Show what an unsubscribe link would do",
  description:
    "Never writes and never spends the token, so a mail scanner that opens the link changes nothing.",
  action: "read",
  query: z.object({ token }),
  response: z.object({
    valid: z.boolean(),
    action,
    postTitle: z.string().nullable(),
  }),
  responseDescription: "The action of a live token, or valid false",
  handler: async ({ db, query }) => {
    const row = await liveToken(db, query.token);
    return {
      valid: Boolean(row),
      action: row?.action ?? null,
      postTitle: row?.postTitle ?? null,
    };
  },
});

const oneClick = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/unsubscribe",
  operationId: "createQuillsUnsubscribe",
  summary: "One-click unsubscribe (RFC 8058)",
  description:
    "The POST a mail provider sends to the List-Unsubscribe URL with the form body List-Unsubscribe=One-Click. The body is not read: the token in the URL is the credential. Answers 200 for every well-formed token.",
  action: "update",
  query: z.object({ token }),
  response: outcome,
  responseDescription: "Whether the token did something",
  event: personal,
  handler: ({ db, query }) => unsubscribe(db, query.token),
});

const confirm = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/unsubscribe/confirm",
  operationId: "processQuillsUnsubscribeToken",
  summary: "Confirm an unsubscribe link",
  description:
    "For the confirmation page: the token goes in the body, not the URL. Answers 200 for every well-formed token.",
  action: "update",
  body: z.object({ token }),
  response: outcome,
  responseDescription: "Whether the token did something",
  event: personal,
  handler: ({ db, body }) => unsubscribe(db, body.token),
});

export default apiRouter()
  .openapi(...preview)
  .openapi(...oneClick)
  .openapi(...confirm);
