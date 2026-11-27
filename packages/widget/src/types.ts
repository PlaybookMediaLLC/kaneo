// Workspace Kaneo URL — e.g. "https://feedback.acme.com"
export type InstanceUrl = string;

/**
 * Languages the widget ships catalogs for, as BCP-47 tags (autocomplete hints
 * for the `locale` option). This is the single source for the `locale` type
 * below. The widget is a standalone package and does not import application catalogs.
 */
export const WIDGET_LOCALES = [
  "en",
  "fr",
  "de",
  "es",
  "ar",
  "ru",
  "pt-BR",
  "zh-CN",
  "zh-TW",
  "nl",
  "pl",
  "th",
  "uk",
] as const;

/** Passed to `Quills("init", ...)` or `Quills.init(...)`. */
export interface InitOptions {
  /** Kaneo instance URL — required when using the npm package. */
  instanceUrl: InstanceUrl;
  /** Kaneo workspace ID or slug. Script-tag installs read it from the sdk.js URL. */
  workspace: string;
  placement?: "left" | "right";
  defaultBoard?: string;
  /**
   * Set `launcher: false` to hide the default floating button and open programmatically, or
   * `{ selector }` to open the widget from your own element. That element gets a
   * `data-quills-unread` attribute with the unread count.
   */
  launcher?: boolean | { selector: string };
  /**
   * A CSS selector of an element on your page: the widget renders inside it, always open,
   * instead of floating. There is no launcher or close button; `open({ view })` still picks the
   * view. Give the element a height (at least 480px works well).
   */
  container?: string;
  /**
   * How a new, unread update is announced: `whisper` (default) shows its title beside the
   * launcher, `full` opens it once per visit, `none` only fires the `announcement` event.
   */
  announcements?: "whisper" | "full" | "none";
  /**
   * How much of the page address goes with feedback and messages: `path` (default) is the
   * origin and path, `origin` only the origin, `none` nothing. The query and fragment never go.
   */
  pageUrl?: "path" | "origin" | "none";
  /** `auto` follows the visitor's system; the default follows the workspace setting. */
  theme?: "auto" | "light" | "dark";
  /** The default launcher's distance in pixels from the bottom and the side edge (20 each). */
  offset?: { bottom?: number; side?: number };
  /**
   * Override the auto-detected UI language. Accepts any BCP-47 tag — the host
   * forwards it and the Kaneo instance resolves the closest catalog it has.
   * The literals are autocomplete hints for the languages the widget ships today
   * (see WIDGET_LOCALES).
   */
  locale?: (typeof WIDGET_LOCALES)[number] | (string & {});
  /** Bundle identity into init — shorthand for init + identify. */
  identity?: Identity;
  /**
   * When to mount the widget iframe and fetch server config: `"interaction"` (default) keeps the
   * host page free of extra requests until the visitor hovers, focuses, clicks or calls `open()`;
   * `"idle"` preloads the iframe during browser idle time.
   */
  preload?: "interaction" | "idle";
  /**
   * Set `tracking: false` to keep host-page visitor analytics off: no pageview
   * beacons and no new device id, for example until the visitor accepts
   * analytics cookies. Turn it on later with `Quills.tracking(true)`, or
   * withdraw with `Quills.tracking(false)`, which also removes a stored
   * device id. Omitting the option keeps the host's last choice. Tracking runs
   * only when the instance also enables visitor analytics.
   */
  tracking?: boolean;
}

/**
 * What the host app passes to identify the current user.
 *
 * For anonymous sessions, call `identify()` with no argument — don't pass
 * `{ anonymous: true }`. (The runtime still accepts `{ anonymous: true }` for
 * backwards-compat with older integrations, but it's not in the type so
 * TypeScript users get nudged to the cleaner form.)
 */
export type Identity =
  | { ssoToken: string }
  | ({ id: string; email: string; name?: string; avatarURL?: string } & Record<
      string,
      unknown
    >);

/**
 * Arguments to `Quills.open(...)`. Discriminated on the target:
 * - omit the payload or `{ view: 'home' }` to open the home view
 * - `{ view: 'new-post', title?, body?, board? }` pre-fills the new-post form
 * - `{ view: 'changelog', entryId? }` opens the changelog, optionally to one entry
 * - `{ view: 'help', query?, category? }` opens help, optionally with search prefilled or one category
 * - `{ view: 'chat' }` opens the live chat view
 * - `{ view: 'messages', body? }` opens the messenger, or a new message prefilled with `body`
 * - `{ view: 'notifications' }` opens the identified visitor's activity
 * - `{ view: 'tickets' }` opens the visitor's tickets list, or messages when that is unavailable
 * - `{ postId }` deep-links to a specific post
 * - `{ articleId }` deep-links to a help article (`article_…` TypeID or slug;
 *   stored `kb_article_…` ids also resolve)
 * - `{ conversationId }` deep-links to a specific conversation thread
 *
 * `postId`, `articleId` and `conversationId` win over `view` when set. `board` applies
 * only to `new-post` — Home filtering uses `init({ defaultBoard })` or `?board=`.
 *
 * The iframe handles every field on this type. A target whose surface is
 * disabled (or a board the visitor cannot see) fails closed — the panel
 * still opens, but the widget does not invent access.
 */
export type OpenOptions =
  | undefined
  | { view?: "home" }
  | { view: "new-post"; title?: string; body?: string; board?: string }
  | { view: "changelog"; entryId?: string }
  | { view: "help"; query?: string; category?: string }
  | { view: "chat" }
  | { view: "messages"; body?: string }
  | { view: "notifications" }
  | { view: "tickets" }
  | { postId: string }
  | { articleId: string }
  | { conversationId: string };

/** Payload types are inferred from the iframe boundary schemas. */
export type { WidgetUser, EventMap } from "./core/protocol.js";
import type { EventMap } from "./core/protocol.js";

export type EventName = keyof EventMap;
export type EventHandler<T extends EventName> = (payload: EventMap[T]) => void;
export type Unsubscribe = () => void;
