import * as z from "zod/mini";
import { identitySchema } from "../core/options.js";
import { viewSchema, type OutboundMessage } from "../core/protocol.js";

/** What the iframe accepts from the SDK. Other inbound types (device, mobile) have no route yet. */
export type ParentMessage =
  | {
      type: "identify";
      identity: z.infer<typeof identitySchema> | null | "invalid";
    }
  | { type: "open"; target: z.infer<typeof openSchema> }
  | { type: "locale"; locale: string }
  /** The host app's metadata and the page URL, for the next feedback post. */
  | { type: "metadata"; metadata: Record<string, string> }
  /** The answer to a capture request: a PNG of the host page, or null. */
  | { type: "capture"; id: string; image: Blob | null };

/** The API's bounds for post metadata: 20 keys of at most 64 characters, values of at most 500. */
export const METADATA_KEYS = 20;
const metadataOf = (data: unknown): Record<string, string> =>
  data && typeof data === "object" && !Array.isArray(data)
    ? Object.fromEntries(
        Object.entries(data)
          .filter(
            (entry): entry is [string, string] =>
              entry[0].trim().length > 0 &&
              entry[0].length <= 64 &&
              typeof entry[1] === "string",
          )
          .slice(0, METADATA_KEYS)
          .map(([key, value]) => [key, value.slice(0, 500)]),
      )
    : {};

/** A TypeID, UUID or slug. No dots or slashes, so a deep link cannot move up the API path. */
const ref = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,200}$/));
const openSchema = z.object({
  view: z.optional(viewSchema),
  postId: z.optional(ref),
  articleId: z.optional(ref),
  entryId: z.optional(ref),
});

/**
 * The iframe side of the quackback:* protocol. Only the parent window may talk to the widget,
 * and its first message fixes the host origin; replies go to that origin only. The ready
 * message carries no data, so it goes out before the origin is known.
 */
export function createParentBridge(
  onMessage: (message: ParentMessage) => void,
) {
  let origin: string | null = null;
  const listener = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent) return;
    if (origin === null) origin = event.origin;
    else if (event.origin !== origin) return;
    const { type, data } = (event.data ?? {}) as {
      type?: unknown;
      data?: unknown;
    };
    if (type === "quackback:identify") {
      const parsed = identitySchema.safeParse(data);
      onMessage({
        type: "identify",
        identity:
          data === null ? null : parsed.success ? parsed.data : "invalid",
      });
    } else if (type === "quackback:open") {
      // A bad target still opens the panel; only the deep link is dropped (fail closed).
      const parsed = openSchema.safeParse(data ?? {});
      onMessage({ type: "open", target: parsed.success ? parsed.data : {} });
    } else if (type === "quackback:locale" && typeof data === "string")
      onMessage({ type: "locale", locale: data.slice(0, 35) });
    else if (type === "quackback:metadata")
      onMessage({ type: "metadata", metadata: metadataOf(data) });
    else if (type === "quackback:capture-result") {
      const { id, image } = (data ?? {}) as { id?: unknown; image?: unknown };
      if (typeof id === "string")
        onMessage({
          type: "capture",
          id,
          image: image instanceof Blob ? image : null,
        });
    }
  };
  window.addEventListener("message", listener);
  return {
    ready() {
      if (window.parent !== window)
        window.parent.postMessage({ type: "quackback:ready" }, "*");
    },
    post(message: OutboundMessage) {
      if (origin !== null) window.parent.postMessage(message, origin);
    },
    dispose() {
      window.removeEventListener("message", listener);
    },
  };
}
export type ParentBridge = ReturnType<typeof createParentBridge>;
