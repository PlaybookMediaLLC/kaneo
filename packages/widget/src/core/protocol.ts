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

const VIEWS = new Set<string>(WIDGET_VIEWS);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NO = { success: false as const };
const ok = (data: OutboundMessage) => ({ success: true as const, data });
const ev = <K extends EventMessage["name"]>(
  name: K,
  payload: EventMap[K],
): EventMessage => ({ type: "quackback:event", name, payload }) as EventMessage;

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseUser(v: unknown): WidgetUser | null {
  if (
    !isRec(v) ||
    !isStr(v.id) ||
    !v.id ||
    !isStr(v.name) ||
    !isStr(v.email) ||
    (v.avatarUrl !== undefined && v.avatarUrl !== null && !isStr(v.avatarUrl))
  )
    return null;
  return {
    id: v.id,
    name: v.name,
    email: v.email,
    ...(v.avatarUrl !== undefined ? { avatarUrl: v.avatarUrl } : {}),
  };
}

function parseWarnings(v: unknown): IdentifyWarning[] | null {
  if (!Array.isArray(v)) return null;
  const list: IdentifyWarning[] = [];
  for (const item of v) {
    if (!isRec(item) || !isStr(item.code) || !isStr(item.field)) return null;
    list.push({ code: item.code, field: item.field });
  }
  return list;
}

function parseEventPayload(name: string, p: unknown): EventMessage | null {
  if (!isRec(p)) return null;
  switch (name) {
    case "ready":
      return ev("ready", {});
    case "close":
      return ev("close", {});
    case "open": {
      if (p.view !== undefined && (!isStr(p.view) || !VIEWS.has(p.view)))
        return null;
      const out: EventMap["open"] = {};
      if (p.view !== undefined) out.view = p.view as WidgetViewName;
      for (const k of [
        "postId",
        "articleId",
        "entryId",
        "conversationId",
      ] as const) {
        if (p[k] !== undefined) {
          if (!isStr(p[k])) return null;
          out[k] = p[k];
        }
      }
      return ev("open", out);
    }
    case "post:created":
      if (
        !isStr(p.id) ||
        !isStr(p.title) ||
        !isRec(p.board) ||
        !isStr(p.board.id) ||
        !isStr(p.board.name) ||
        !isStr(p.board.slug) ||
        (p.statusId !== null && !isStr(p.statusId))
      )
        return null;
      return ev("post:created", {
        id: p.id,
        title: p.title,
        board: { id: p.board.id, name: p.board.name, slug: p.board.slug },
        statusId: p.statusId,
      });
    case "vote":
      if (
        !isStr(p.postId) ||
        !isBool(p.voted) ||
        (p.voteCount !== undefined && !isCount(p.voteCount))
      )
        return null;
      return ev("vote", {
        postId: p.postId,
        voted: p.voted,
        ...(p.voteCount !== undefined ? { voteCount: p.voteCount } : {}),
      });
    case "comment:created":
      if (
        !isStr(p.postId) ||
        !isStr(p.commentId) ||
        (p.parentId !== null && !isStr(p.parentId))
      )
        return null;
      return ev("comment:created", {
        postId: p.postId,
        commentId: p.commentId,
        parentId: p.parentId,
      });
    case "identify": {
      if (!isBool(p.success) || !isBool(p.anonymous)) return null;
      const user = p.user === null ? null : parseUser(p.user);
      if (p.user !== null && !user) return null;
      if (p.error !== undefined && !isStr(p.error)) return null;
      const warnings =
        p.warnings === undefined ? undefined : parseWarnings(p.warnings);
      if (warnings === null) return null;
      return ev("identify", {
        success: p.success,
        user,
        anonymous: p.anonymous,
        ...(p.error !== undefined ? { error: p.error } : {}),
        ...(warnings !== undefined ? { warnings } : {}),
      });
    }
    case "email-submitted":
      return isStr(p.email) ? ev("email-submitted", { email: p.email }) : null;
    case "unread":
      return isCount(p.count) ? ev("unread", { count: p.count }) : null;
    case "presence":
      return isBool(p.online) && isBool(p.withinOfficeHours)
        ? ev("presence", {
            online: p.online,
            withinOfficeHours: p.withinOfficeHours,
          })
        : null;
    default:
      return null;
  }
}

export const outboundMessageSchema = {
  safeParse(
    raw: unknown,
  ): { success: true; data: OutboundMessage } | { success: false } {
    if (!isRec(raw) || !isStr(raw.type)) return NO;
    switch (raw.type) {
      case "quackback:ready":
        return ok({ type: "quackback:ready" });
      case "quackback:close":
        return ok({ type: "quackback:close" });
      case "quackback:navigate":
        return isStr(raw.url)
          ? ok({ type: "quackback:navigate", url: raw.url })
          : NO;
      case "quackback:expand":
        return isBool(raw.expanded)
          ? ok({ type: "quackback:expand", expanded: raw.expanded })
          : NO;
      case "quackback:identify-result": {
        if (!isBool(raw.success)) return NO;
        let user: WidgetUser | null | undefined;
        if (raw.user === null) user = null;
        else if (raw.user !== undefined) {
          const parsed = parseUser(raw.user);
          if (!parsed) return NO;
          user = parsed;
        }
        if (raw.error !== undefined && !isStr(raw.error)) return NO;
        const warnings =
          raw.warnings === undefined ? undefined : parseWarnings(raw.warnings);
        if (warnings === null) return NO;
        return ok({
          type: "quackback:identify-result",
          success: raw.success,
          ...(raw.user !== undefined ? { user } : {}),
          ...(raw.error !== undefined ? { error: raw.error } : {}),
          ...(warnings !== undefined ? { warnings } : {}),
        });
      }
      case "quackback:auth-change": {
        const user = raw.user === null ? null : parseUser(raw.user);
        return raw.user !== null && !user
          ? NO
          : ok({ type: "quackback:auth-change", user });
      }
      case "quackback:unread":
        return isCount(raw.count)
          ? ok({ type: "quackback:unread", count: raw.count })
          : NO;
      case "quackback:announce":
        return isStr(raw.entryId) &&
          SAFE_ID.test(raw.entryId) &&
          isStr(raw.title) &&
          raw.title.length >= 1 &&
          raw.title.length <= 300 &&
          isBool(raw.open)
          ? ok({
              type: "quackback:announce",
              entryId: raw.entryId,
              title: raw.title,
              open: raw.open,
            })
          : NO;
      case "quackback:capture":
        return isStr(raw.id) && SAFE_ID.test(raw.id)
          ? ok({ type: "quackback:capture", id: raw.id })
          : NO;
      case "quackback:event": {
        const evt = isStr(raw.name)
          ? parseEventPayload(raw.name, raw.payload)
          : null;
        return evt ? ok(evt) : NO;
      }
      default:
        return NO;
    }
  },
};
