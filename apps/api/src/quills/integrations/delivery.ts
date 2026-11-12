// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { ProviderCallError } from "../framework/integration-config";
import type { DeliveredEvent } from "./catalog";

// The provider side of the integration worker (jobs/handlers/integration-send.ts). A provider in
// providers/ that sends declares `deliver`. The worker claims the operation, refreshes a due token
// and checks the target, then calls `deliver` with no transaction open.

/** What a delivery says about one post, read from the live rows at claim time. */
export type Content = {
  board: string;
  boardId: string;
  post: { id: string; title: string; content: string; author: string };
  statusName?: string;
  comment?: { id: string; content: string; author: string };
};

export type Outcome = {
  state: "succeeded" | "retry_wait" | "failed" | "auth_required" | "uncertain";
  errorCode?: string;
  /** The created item. The worker links it to the post (`post_external_links`). */
  result?: {
    externalId: string;
    externalUrl: string | null;
    /** A readable label when the ID is not one, for example a Linear `ENG-12`. */
    externalDisplayId?: string;
  };
  /** Secrets refreshed before the call, to store with the outcome. */
  refreshed?: Record<string, string>;
};

/** What a provider's `deliver` gets. */
export type DeliveryContext = {
  /** The connection's secrets, with a fresh access token. */
  secrets: Record<string, string>;
  /** The connection's non-secret values, for example a cloud ID. Check each one before it enters a URL. */
  config: Record<string, unknown>;
  /** The workspace's OAuth app (platform credentials). Empty for a key provider. */
  app: Record<string, string>;
  /** The channel. It passed the provider's `target` rule. */
  target: string;
  type: DeliveredEvent;
  content: Content;
};

export const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
export const uncertain: Outcome = {
  state: "uncertain",
  errorCode: "outcome_unknown",
};

/** Only a status from a received response proves a rejection. */
export function statusOutcome(
  status: number,
  retryServerErrors: boolean,
): Outcome {
  if (status === 401 || status === 403)
    return { state: "auth_required", errorCode: "authentication" };
  if (status === 408 || status === 429 || (retryServerErrors && status >= 500))
    return { state: "retry_wait", errorCode: "unavailable" };
  if (status >= 400 && status < 500)
    return { state: "failed", errorCode: "provider_failed" };
  return uncertain;
}

/** A provider call's failure as an outcome. A create that got a 5xx or no answer may exist: uncertain. */
export function callFailed(error: unknown, create = true): Outcome {
  if (!(error instanceof ProviderCallError)) return uncertain;
  if (error.status === null) return uncertain;
  return statusOutcome(error.status, !create);
}

/**
 * The scopes that a token answer grants, space-separated, for `config.scopes`. The answer names them
 * as a string or a list; an answer without them granted the requested scopes (RFC 6749, 5.1).
 */
export function grantedScopes(
  token: Record<string, unknown>,
  requested: string,
) {
  const scope = Array.isArray(token.scope)
    ? token.scope.join(" ")
    : token.scope;
  return (typeof scope === "string" && scope.trim() ? scope : requested)
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);
}

/** True when `config.scopes` holds every scope in `needed`. */
export const hasScopes = (
  config: Record<string, unknown>,
  needed: readonly string[],
) => {
  const granted = new Set(
    (typeof config.scopes === "string" ? config.scopes : "").split(" "),
  );
  return needed.every((scope) => granted.has(scope));
};

/** A chat message for each delivered event (Slack, Discord). */
export const chatText = (d: { type: DeliveredEvent; content: Content }) => {
  const { post, comment, statusName } = d.content;
  if (d.type === "post.created")
    return clip(
      `New feedback: ${post.title}\n${clip(post.content, 500)}`,
      1900,
    );
  if (d.type === "post.status_changed")
    return clip(
      `Status changed: ${post.title}${statusName ? ` → ${statusName}` : ""}`,
      1900,
    );
  return clip(
    `New comment on ${post.title}\n${clip(comment?.content ?? "", 500)}`,
    1900,
  );
};

/**
 * The Markdown body of an issue for a new post (GitHub, GitLab, Linear). The post content is
 * Markdown already; `max` bounds it.
 */
export const issueBody = (d: { content: Content }, max = Infinity) =>
  [
    clip(d.content.post.content, max),
    "",
    "---",
    `**Submitted by:** ${d.content.post.author}`,
    `**Board:** ${d.content.board}`,
  ].join("\n");

/**
 * The plain-text parts of an issue for a new post, for a provider that formats them itself (Jira's
 * document format, Azure DevOps HTML). The title is one line of at most 255 characters. The content
 * keeps at most 2000 characters, one paragraph for each line that is not empty.
 */
export function issueParts(content: Content) {
  return {
    title: clip(content.post.title.replace(/\s+/g, " ").trim(), 255),
    paragraphs: clip(content.post.content, 2000)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    footer: [
      `Submitted by: ${clip(content.post.author, 200)}`,
      `Board: ${clip(content.board, 200)}`,
    ],
  };
}
