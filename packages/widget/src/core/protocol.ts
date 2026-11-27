// Zero-dependency iframe boundary validators for the host facade (#316).

export interface WidgetUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export const WIDGET_VIEWS = [
  "home",
  "new-post",
  "changelog",
  "help",
  "chat",
  "messages",
  "tickets",
  "notifications",
] as const;

export type WidgetViewName = (typeof WIDGET_VIEWS)[number];

export interface IdentifyWarning {
  code: string;
  field: string;
}

export interface EventMap {
  ready: Record<string, never>;
  open: {
    view?: WidgetViewName;
    postId?: string;
    articleId?: string;
    entryId?: string;
    conversationId?: string;
  };
  close: Record<string, never>;
  "post:created": {
    id: string;
    title: string;
    board: { id: string; name: string; slug: string };
    statusId: string | null;
  };
  vote: {
    postId: string;
    voted: boolean;
    voteCount?: number;
  };
  "comment:created": {
    postId: string;
    commentId: string;
    parentId: string | null;
  };
  identify: {
    success: boolean;
    user: WidgetUser | null;
    anonymous: boolean;
    error?: string;
    warnings?: IdentifyWarning[];
  };
  "email-submitted": { email: string };
  unread: { count: number };
  presence: { online: boolean; withinOfficeHours: boolean };
  statechange: {
    initialized: boolean;
    open: boolean;
    placement: "left" | "right";
    theme: "auto" | "light" | "dark";
    locale: string | null;
    unreadCount: number;
    user: WidgetUser | null;
    identified: boolean;
  };
  announcement: { entryId: string; title: string };
  error: { code: string; message: string };
}

type EventMessage = {
  [
    K in
      | "ready"
      | "open"
      | "close"
      | "post:created"
      | "vote"
      | "comment:created"
      | "identify"
      | "email-submitted"
      | "unread"
      | "presence"
  ]: {
    type: "quackback:event";
    name: K;
    payload: EventMap[K];
  };
}[
  | "ready"
  | "open"
  | "close"
  | "post:created"
  | "vote"
  | "comment:created"
  | "identify"
  | "email-submitted"
  | "unread"
  | "presence"];

export type OutboundMessage =
  | { type: "quackback:ready" }
  | { type: "quackback:close" }
  | { type: "quackback:navigate"; url: string }
  | { type: "quackback:expand"; expanded: boolean }
  | {
      type: "quackback:identify-result";
      success: boolean;
      user?: WidgetUser | null;
      error?: string;
      warnings?: IdentifyWarning[];
    }
  | { type: "quackback:auth-change"; user: WidgetUser | null }
  | { type: "quackback:unread"; count: number }
  | {
      type: "quackback:announce";
      entryId: string;
      title: string;
      open: boolean;
    }
  | { type: "quackback:capture"; id: string }
  | EventMessage;

const VIEWS = new Set<string>([
  "home",
  "new-post",
  "changelog",
  "help",
  "chat",
  "messages",
  "tickets",
  "notifications",
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isRec(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseUser(value: unknown): WidgetUser | null {
  if (!isRec(value)) return null;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    typeof value.email !== "string"
  ) {
    return null;
  }
  if (
    value.avatarUrl !== undefined &&
    value.avatarUrl !== null &&
    typeof value.avatarUrl !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    ...(value.avatarUrl !== undefined ? { avatarUrl: value.avatarUrl } : {}),
  };
}

function parseWarnings(value: unknown): IdentifyWarning[] | null {
  if (!Array.isArray(value)) return null;
  const list: IdentifyWarning[] = [];
  for (const item of value) {
    if (
      !isRec(item) ||
      typeof item.code !== "string" ||
      typeof item.field !== "string"
    ) {
      return null;
    }
    list.push({ code: item.code, field: item.field });
  }
  return list;
}

function parseEventPayload(name: string, p: unknown): EventMessage | null {
  if (!isRec(p)) return null;
  switch (name) {
    case "ready":
      return { type: "quackback:event", name: "ready", payload: {} };
    case "close":
      return { type: "quackback:event", name: "close", payload: {} };
    case "open": {
      if (
        p.view !== undefined &&
        (typeof p.view !== "string" || !VIEWS.has(p.view))
      )
        return null;
      for (const k of [
        "postId",
        "articleId",
        "entryId",
        "conversationId",
      ] as const) {
        if (p[k] !== undefined && typeof p[k] !== "string") return null;
      }
      return {
        type: "quackback:event",
        name: "open",
        payload: {
          ...(p.view !== undefined ? { view: p.view as WidgetViewName } : {}),
          ...(p.postId !== undefined ? { postId: p.postId as string } : {}),
          ...(p.articleId !== undefined
            ? { articleId: p.articleId as string }
            : {}),
          ...(p.entryId !== undefined ? { entryId: p.entryId as string } : {}),
          ...(p.conversationId !== undefined
            ? { conversationId: p.conversationId as string }
            : {}),
        },
      };
    }
    case "post:created": {
      if (
        typeof p.id !== "string" ||
        typeof p.title !== "string" ||
        !isRec(p.board) ||
        typeof p.board.id !== "string" ||
        typeof p.board.name !== "string" ||
        typeof p.board.slug !== "string" ||
        (p.statusId !== null && typeof p.statusId !== "string")
      )
        return null;
      return {
        type: "quackback:event",
        name: "post:created",
        payload: {
          id: p.id,
          title: p.title,
          board: { id: p.board.id, name: p.board.name, slug: p.board.slug },
          statusId: p.statusId,
        },
      };
    }
    case "vote": {
      if (
        typeof p.postId !== "string" ||
        typeof p.voted !== "boolean" ||
        (p.voteCount !== undefined && !isCount(p.voteCount))
      )
        return null;
      return {
        type: "quackback:event",
        name: "vote",
        payload: {
          postId: p.postId,
          voted: p.voted,
          ...(p.voteCount !== undefined ? { voteCount: p.voteCount } : {}),
        },
      };
    }
    case "comment:created": {
      if (
        typeof p.postId !== "string" ||
        typeof p.commentId !== "string" ||
        (p.parentId !== null && typeof p.parentId !== "string")
      )
        return null;
      return {
        type: "quackback:event",
        name: "comment:created",
        payload: {
          postId: p.postId,
          commentId: p.commentId,
          parentId: p.parentId,
        },
      };
    }
    case "identify": {
      if (typeof p.success !== "boolean" || typeof p.anonymous !== "boolean")
        return null;
      const user = p.user === null ? null : parseUser(p.user);
      if (p.user !== null && !user) return null;
      if (p.error !== undefined && typeof p.error !== "string") return null;
      const warnings =
        p.warnings === undefined ? undefined : parseWarnings(p.warnings);
      if (warnings === null) return null;
      return {
        type: "quackback:event",
        name: "identify",
        payload: {
          success: p.success,
          user,
          anonymous: p.anonymous,
          ...(p.error !== undefined ? { error: p.error } : {}),
          ...(warnings !== undefined ? { warnings } : {}),
        },
      };
    }
    case "email-submitted":
      if (typeof p.email !== "string") return null;
      return {
        type: "quackback:event",
        name: "email-submitted",
        payload: { email: p.email },
      };
    case "unread":
      if (!isCount(p.count)) return null;
      return {
        type: "quackback:event",
        name: "unread",
        payload: { count: p.count },
      };
    case "presence":
      if (
        typeof p.online !== "boolean" ||
        typeof p.withinOfficeHours !== "boolean"
      )
        return null;
      return {
        type: "quackback:event",
        name: "presence",
        payload: { online: p.online, withinOfficeHours: p.withinOfficeHours },
      };
    default:
      return null;
  }
}

export const outboundMessageSchema = {
  safeParse(
    raw: unknown,
  ): { success: true; data: OutboundMessage } | { success: false } {
    if (!isRec(raw) || typeof raw.type !== "string") return { success: false };
    switch (raw.type) {
      case "quackback:ready":
        return { success: true, data: { type: "quackback:ready" } };
      case "quackback:close":
        return { success: true, data: { type: "quackback:close" } };
      case "quackback:navigate":
        return typeof raw.url === "string"
          ? {
              success: true,
              data: { type: "quackback:navigate", url: raw.url },
            }
          : { success: false };
      case "quackback:expand":
        return typeof raw.expanded === "boolean"
          ? {
              success: true,
              data: { type: "quackback:expand", expanded: raw.expanded },
            }
          : { success: false };
      case "quackback:identify-result": {
        if (typeof raw.success !== "boolean") return { success: false };
        let user: WidgetUser | null | undefined;
        if (raw.user === null) user = null;
        else if (raw.user !== undefined) {
          const parsed = parseUser(raw.user);
          if (!parsed) return { success: false };
          user = parsed;
        }
        if (raw.error !== undefined && typeof raw.error !== "string")
          return { success: false };
        const warnings =
          raw.warnings === undefined ? undefined : parseWarnings(raw.warnings);
        if (warnings === null) return { success: false };
        return {
          success: true,
          data: {
            type: "quackback:identify-result",
            success: raw.success,
            ...(raw.user !== undefined ? { user } : {}),
            ...(raw.error !== undefined ? { error: raw.error } : {}),
            ...(warnings !== undefined ? { warnings } : {}),
          },
        };
      }
      case "quackback:auth-change": {
        const user = raw.user === null ? null : parseUser(raw.user);
        if (raw.user !== null && !user) return { success: false };
        return { success: true, data: { type: "quackback:auth-change", user } };
      }
      case "quackback:unread":
        return isCount(raw.count)
          ? {
              success: true,
              data: { type: "quackback:unread", count: raw.count },
            }
          : { success: false };
      case "quackback:announce":
        if (
          typeof raw.entryId !== "string" ||
          !SAFE_ID.test(raw.entryId) ||
          typeof raw.title !== "string" ||
          raw.title.length < 1 ||
          raw.title.length > 300 ||
          typeof raw.open !== "boolean"
        ) {
          return { success: false };
        }
        return {
          success: true,
          data: {
            type: "quackback:announce",
            entryId: raw.entryId,
            title: raw.title,
            open: raw.open,
          },
        };
      case "quackback:capture":
        return typeof raw.id === "string" && SAFE_ID.test(raw.id)
          ? { success: true, data: { type: "quackback:capture", id: raw.id } }
          : { success: false };
      case "quackback:event": {
        if (typeof raw.name !== "string") return { success: false };
        const evt = parseEventPayload(raw.name, raw.payload);
        return evt ? { success: true, data: evt } : { success: false };
      }
      default:
        return { success: false };
    }
  },
};
