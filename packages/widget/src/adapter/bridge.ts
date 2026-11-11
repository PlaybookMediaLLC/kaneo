import * as z from "zod/mini";
import { identitySchema } from "../core/options.js";
import { viewSchema, type OutboundMessage } from "../core/protocol.js";

/** What the iframe accepts from the SDK. Other inbound types (metadata, device, mobile) have no route yet. */
export type ParentMessage =
  | {
      type: "identify";
      identity: z.infer<typeof identitySchema> | null | "invalid";
    }
  | { type: "open"; target: z.infer<typeof openSchema> }
  | { type: "locale"; locale: string };

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
