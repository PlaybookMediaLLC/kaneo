import { assertPublicDestination } from "../../../utils/assert-public-destination";
import { DestinationLookupError } from "../../../utils/destination-lookup-error";
import {
  OutboundRequestError,
  sendOutboundRequest,
} from "../../../utils/outbound-request";
import { withoutOutboundTelemetry } from "../../../utils/sensitive-outbound";
import { ProviderCallError } from "../../framework/integration-config";
import { provider, type DeliveredEvent } from "../../integrations/catalog";
import {
  callFailed,
  clip,
  statusOutcome,
  uncertain,
  type Content,
  type Outcome,
} from "../../integrations/delivery";
import {
  freshSecrets,
  oauthProvider,
  validTarget,
} from "../../integrations/providers";

export type { Content, Outcome };
export type Delivery = {
  provider: string;
  credentials: Record<string, string>;
  /** The workspace's OAuth app (platform credentials), for OAuth providers. */
  app?: Record<string, string>;
  /** The connection's non-secret values (integrations.config), for providers in providers/. */
  config?: Record<string, unknown>;
  /** The channel, or `default` for the connection itself. */
  target: string;
  type: DeliveredEvent;
  occurredAt: Date;
  content: Content;
  /** Sent to webhook receivers as `x-kaneo-delivery`, so they can drop a repeat. */
  deliveryId: string;
};

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
          "user-agent": "Quills-Integration/1.0",
          ...headers,
        },
      },
      { publicDestination: true, timeoutMs: 5_000 },
    );
    return { state: "succeeded" };
  } catch (error) {
    const reason = error instanceof OutboundRequestError ? error.reason : "";
    if (reason === "http")
      return statusOutcome((error as OutboundRequestError).status ?? 0, true);
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
    return statusOutcome(response.status, false);
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

/**
 * A provider in providers/ sends through its `deliver`, only for an event in its `events`. A due
 * token is refreshed first; the new secrets return in the outcome and are stored in the settling
 * transaction. A refused call that `deliver` throws becomes an outcome here.
 */
async function deliverOAuth(d: Delivery): Promise<Outcome> {
  const registered = oauthProvider(d.provider);
  if (!registered?.deliver)
    return { state: "failed", errorCode: "provider_failed" };
  if (!registered.events.includes(d.type)) return { state: "succeeded" };
  let secrets = d.credentials;
  let refreshed: Record<string, string> | undefined;
  try {
    const fresh = await freshSecrets(d.provider, d.credentials, d.app ?? {});
    secrets = fresh.secrets;
    refreshed = fresh.refreshed ?? undefined;
  } catch (error) {
    // The delivery was not sent: never uncertain. A failed refresh needs a reconnect.
    return error instanceof ProviderCallError &&
      error.status !== null &&
      error.status < 500
      ? { state: "auth_required", errorCode: "authentication" }
      : { state: "retry_wait", errorCode: "unavailable" };
  }
  // A channel ID from a mapping goes into a provider URL path: refuse `..` and other shapes.
  if (!validTarget(d.provider, d.target))
    return { state: "failed", errorCode: "provider_failed", refreshed };
  try {
    return {
      ...(await registered.deliver({
        secrets,
        config: d.config ?? {},
        app: d.app ?? {},
        target: d.target,
        type: d.type,
        content: d.content,
      })),
      refreshed,
    };
  } catch (error) {
    return { ...callFailed(error), refreshed };
  }
}

/** Sends one delivery. Never retries inside; the job and the operation state decide. */
export async function deliver(d: Delivery): Promise<Outcome> {
  if (oauthProvider(d.provider)) return deliverOAuth(d);
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
