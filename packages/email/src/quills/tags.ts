/**
 * Provider tags for the sends inside a scope. Resend returns a message's tags
 * with its delivery events (bounced, complained), so the application can name
 * the workspace and log row of an event from values it wrote itself.
 *
 * Scoped by async context like the idempotency key: the caller that owns the
 * delivery ledger opens the scope, whichever sender it then calls.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type EmailTag = { name: string; value: string };

const scope = new AsyncLocalStorage<EmailTag[]>();
/** Resend's tag rule: ASCII letters, digits, underscores and dashes, at most 256 characters. */
const TAG = /^[A-Za-z0-9_-]{1,256}$/;

/** Run `fn` with every send inside it carrying `tags`. Invalid tags throw before any send. */
export function withEmailTags<T>(tags: EmailTag[], fn: () => T): T {
  for (const tag of tags)
    if (!TAG.test(tag.name) || !TAG.test(tag.value))
      throw new Error("Email tags allow letters, digits, _ and - only");
  return tags.length ? scope.run(tags, fn) : fn();
}

/** The tags of the current scope, or undefined outside one. */
export function currentEmailTags(): EmailTag[] | undefined {
  return scope.getStore();
}
