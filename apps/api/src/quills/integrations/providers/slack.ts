// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { callFailed, chatText, uncertain } from "../delivery";
import {
  form,
  formHeaders,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

/** Channel messages, and the assistant: mentions, direct messages and the asker's profile email. */
export const SLACK_SCOPES = [
  "chat:write",
  "channels:read",
  "app_mentions:read",
  "im:history",
  "users:read",
  "users:read.email",
];

export const slack = {
  name: "Slack",
  hosts: /^slack\.com$/,
  category: "notifications",
  description: "Post feedback events to Slack channels.",
  events: ["post.created", "post.status_changed", "comment.created"],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://slack.com/oauth/v2/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      state,
      scope: SLACK_SCOPES.join(","),
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          code,
          redirect_uri: redirectUri,
        }),
      }),
    );
    // Slack answers 200 with ok: false for a rejected code.
    const accessToken = text(token.access_token);
    if (token.ok !== true || !accessToken) throw rejected();
    const team = record(token.team);
    return {
      secrets: { accessToken },
      workspaceName: text(team.name) || "Slack",
      account: text(team.name) || null,
      config: {
        teamId: text(team.id),
        scopes: text(token.scope),
        botUserId: text(token.bot_user_id),
      },
    };
  },
  destinations: async (secrets) => {
    const answer = record(
      await providerJson(
        "https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200",
        { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
      ),
    );
    if (answer.ok !== true) throw new ProviderCallError(401);
    return list(answer.channels)
      .map(record)
      .map((channel) => ({
        id: text(channel.id),
        name: `#${text(channel.name)}`,
      }));
  },
  statuses: [],
  // A message for each delivered event.
  deliver: async (d) => {
    let answer: { ok?: unknown; error?: unknown } | null;
    try {
      answer = (await providerJson("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${d.secrets.accessToken ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ channel: d.target, text: chatText(d) }),
      })) as { ok?: unknown; error?: unknown } | null;
    } catch (error) {
      // A message is not a create: a 5xx waits for a retry.
      return callFailed(error, false);
    }
    if (answer?.ok === true) return { state: "succeeded" };
    // An unreadable answer, or an error that Slack says may have partly succeeded: it may have posted.
    if (
      !answer ||
      ["internal_error", "fatal_error", "request_timeout"].includes(
        String(answer.error),
      )
    )
      return uncertain;
    // Slack answers 200 with ok: false and an error name.
    return [
      "invalid_auth",
      "token_revoked",
      "account_inactive",
      "not_authed",
    ].includes(String(answer.error))
      ? { state: "auth_required", errorCode: "authentication" }
      : { state: "failed", errorCode: "provider_failed" };
  },
} satisfies OAuthProvider;
