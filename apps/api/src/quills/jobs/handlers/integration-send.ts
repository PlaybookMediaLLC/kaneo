import { assertPublicDestination } from "../../../utils/assert-public-destination";
import { DestinationLookupError } from "../../../utils/destination-lookup-error";
import {
  OutboundRequestError,
  sendOutboundRequest,
} from "../../../utils/outbound-request";
import { withoutOutboundTelemetry } from "../../../utils/sensitive-outbound";
import { provider, type DeliveredEvent } from "../../integrations/catalog";

/** What a delivery says about one post, read from the live rows at claim time. */
export type Content = {
  board: string;
  boardId: string;
  post: { id: string; title: string; content: string; author: string };
  statusName?: string;
  comment?: { id: string; content: string; author: string };
};
export type Delivery = {
  provider: string;
  credentials: Record<string, string>;
  /** The channel, or `default` for the connection itself. */
  target: string;
  type: DeliveredEvent;
  occurredAt: Date;
  content: Content;
  /** Sent to webhook receivers as `x-kaneo-delivery`, so they can drop a repeat. */
  deliveryId: string;
};
export type Outcome = {
  state: "succeeded" | "retry_wait" | "failed" | "auth_required" | "uncertain";
  errorCode?: string;
  result?: { externalId: string; externalUrl: string | null };
};

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
const uncertain: Outcome = { state: "uncertain", errorCode: "outcome_unknown" };

/** Only a status from a received response proves a rejection. */
function rejected(status: number, retryServerErrors: boolean): Outcome {
  if (status === 401 || status === 403)
    return { state: "auth_required", errorCode: "authentication" };
  if (status === 408 || status === 429 || (retryServerErrors && status >= 500))
    return { state: "retry_wait", errorCode: "unavailable" };
  if (status >= 400 && status < 500)
    return { state: "failed", errorCode: "provider_failed" };
  return uncertain;
}

/** The source's generic JSON for Make, n8n and Zapier, without author email or portal URLs. */
export function webhookPayload(d: Delivery) {
  const { post, comment, statusName } = d.content;
  return {
    event: d.type,
    timestamp: d.occurredAt.toISOString(),
    post: {
      id: post.id,
      title: post.title,
      board: d.content.board,
      author_name: post.author,
      ...(d.type === "post.created" && { content: clip(post.content, 1000) }),
    },
    ...(statusName && { status_change: { new: statusName } }),
    ...(comment && {
      comment: {
        id: comment.id,
        content: clip(comment.content, 1000),
        author_name: comment.author,
      },
    }),
  };
}

export function ntfyMessage(d: Delivery, topic: string) {
  const { post, comment, statusName } = d.content;
  if (d.type === "post.created")
    return {
      topic,
      title: clip(`New feedback: ${post.title}`, 250),
      message: clip(post.content, 500) || post.title,
      tags: ["speech_balloon"],
    };
  if (d.type === "post.status_changed" && statusName)
    return {
      topic,
      title: clip(`Status changed: ${post.title}`, 250),
      message: `Now ${statusName}`,
      tags: ["arrows_counterclockwise"],
    };
  if (d.type === "comment.created" && comment)
    return {
      topic,
      title: clip(`New comment: ${post.title}`, 250),
      message: clip(comment.content, 500) || `New comment on "${post.title}"`,
      tags: ["speech_balloon"],
    };
  return undefined;
}

/** A POST to a webhook-style URL through the instance webhook checks: public address, DNS-pinned socket. */
async function postJson(
  type: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Outcome> {
  const hosts = provider(type)?.hosts;
  try {
    const target = new URL(url);
    // A row that bypassed the route, or a URL edited elsewhere, is refused too.
    if (hosts && (target.protocol !== "https:" || !hosts.test(target.hostname)))
      return { state: "failed", errorCode: "destination_rejected" };
    await assertPublicDestination(url, "Integration");
  } catch (error) {
    return error instanceof DestinationLookupError
      ? { state: "retry_wait", errorCode: "unavailable" }
      : { state: "failed", errorCode: "destination_rejected" };
  }
  try {
    await sendOutboundRequest(
      url,
      {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          "user-agent": "Kaneo-Quills-Integration/1.0",
          ...headers,
        },
      },
      { publicDestination: true, timeoutMs: 5_000 },
    );
    return { state: "succeeded" };
  } catch (error) {
    const reason = error instanceof OutboundRequestError ? error.reason : "";
    if (reason === "http")
      return rejected((error as OutboundRequestError).status ?? 0, true);
    if (reason === "destination")
      return { state: "failed", errorCode: "destination_rejected" };
    // A timeout or a broken connection can follow a request that the receiver accepted.
    // ponytail: the helper hides the cause, so a refused connection is also uncertain, as in webhook.ts.
    return uncertain;
  }
}

/** Creates a Shortcut story. A story without an ID in the answer counts as uncertain: it may exist. */
async function createStory(d: Delivery): Promise<Outcome> {
  const { post, board } = d.content;
  let response: Response;
  try {
    // A fixed provider host; no redirect, no retry. The token travels in a header, outside HTTP telemetry.
    response = await withoutOutboundTelemetry(() =>
      fetch("https://api.app.shortcut.com/api/v3/stories", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "shortcut-token": d.credentials.apiKey ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: clip(post.title, 512),
          description: [
            post.content,
            "",
            "---",
            `**Submitted by:** ${post.author}`,
            `**Board:** ${board}`,
          ].join("\n"),
          story_type: "feature",
          ...(d.target !== "default" && { group_id: d.target }),
        }),
      }),
    );
  } catch {
    // ponytail: fetch hides whether the request left; a DNS failure is also uncertain. Classify if it recurs.
    return uncertain;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    // A 5xx after a create can mean the story exists.
    return rejected(response.status, false);
  }
  const story = (await response.json().catch(() => null)) as {
    id?: unknown;
    app_url?: unknown;
  } | null;
  if (typeof story?.id !== "number" && typeof story?.id !== "string")
    return uncertain;
  const link =
    typeof story.app_url === "string" && story.app_url.startsWith("https://")
      ? story.app_url
      : null;
  return {
    state: "succeeded",
    result: { externalId: String(story.id), externalUrl: link },
  };
}

/** Sends one delivery. Never retries inside; the job and the operation state decide. */
export async function deliver(d: Delivery): Promise<Outcome> {
  const url = d.credentials.url ?? "";
  switch (d.provider) {
    case "make":
    case "n8n":
    case "zapier":
      return postJson(d.provider, url, webhookPayload(d), {
        "x-kaneo-delivery": d.deliveryId,
      });
    case "ntfy": {
      let origin: string, topic: string;
      try {
        const parsed = new URL(url);
        origin = parsed.origin;
        topic = parsed.pathname.replace(/^\/+|\/+$/g, "");
      } catch {
        return { state: "failed", errorCode: "provider_failed" };
      }
      const message = ntfyMessage(d, topic);
      if (!message) return { state: "succeeded" };
      return postJson(
        d.provider,
        `${origin}/`,
        message,
        d.credentials.token
          ? { authorization: `Bearer ${d.credentials.token}` }
          : {},
      );
    }
    case "shortcut":
      return d.type === "post.created"
        ? createStory(d)
        : { state: "succeeded" };
    default:
      return { state: "failed", errorCode: "provider_failed" };
  }
}
