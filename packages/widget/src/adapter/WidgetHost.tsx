import { removeAvatar, squareAvatar, uploadAvatar } from "./avatar.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WidgetView } from "../ui/WidgetView.js";
import { ApiError, createApi } from "./api.js";
import {
  createParentBridge,
  type ParentBridge,
  type ParentMessage,
} from "./bridge.js";
import { loadArticle, type Surfaces } from "./load.js";
import { writes } from "./writes.js";
import { useWidgetSurvey } from "./surveys.js";
import { useWidgetActivity } from "./activity.js";
import { useWidgetContactEmail } from "./contact-email.js";
import { openPortalSignedIn } from "./portal-link.js";
import { useUpdatesSubscription } from "./updates-subscription.js";
import { useWidgetTeam } from "./team.js";
import { Unavailable } from "./Unavailable.js";
import { useWidgetData } from "./useWidgetData.js";
import { useWidgetSession } from "./useWidgetSession.js";
import { useHostCapture } from "./useHostCapture.js";
import type { OutboundMessage } from "../core/protocol.js";
import type { WidgetTab, WidgetViewProps } from "../ui/types.js";
import { directionOf } from "../ui/direction.js";

type Config = {
  theme: "light" | "dark" | "auto";
  replyTime: "minutes" | "hours" | "day" | null;
  greeting: { title: string | null; subtitle: string | null };
  surfaces: Surfaces;
  tabs: WidgetTab[];
  pollIntervalMs: number;
  ai: boolean;
};
type Target = Extract<ParentMessage, { type: "open" }>["target"];
type Navigation = NonNullable<WidgetViewProps["navigation"]>;

/** A deep link as a view request. `articleId` may be a slug, so the host resolves it first. */
function navigationFor(target: Target):
  | (Omit<Navigation, "detail"> & {
      detail?: string;
      article?: string;
      /** The board slug or ID for the deep-linked new post. */
      board?: string;
    })
  | null {
  if (target.postId) return { tab: "feedback", detail: target.postId };
  if (target.articleId) return { tab: "help", article: target.articleId };
  if (target.conversationId)
    return { tab: "messages", detail: target.conversationId };
  switch (target.view) {
    case "new-post": {
      const draft = [target.title, target.body].filter(Boolean).join("\n");
      return {
        tab: "feedback",
        composer: "feedback",
        ...(draft && { draft }),
        ...(target.board && { board: target.board }),
      };
    }
    case "changelog":
      return { tab: "updates", detail: target.entryId };
    case "help":
      return {
        tab: "help",
        ...(target.query && { query: target.query }),
        ...(target.category && { category: target.category }),
      };
    case "messages":
      return target.body
        ? { tab: "messages", composer: "message", draft: target.body }
        : { tab: "messages" };
    case "chat":
    case "tickets":
      return { tab: "messages" };
    case "notifications":
      return { tab: "home", activity: true };
    case "home":
      return { tab: "home" };
    default:
      return null;
  }
}

/**
 * The page inside the SDK's iframe: one workspace's widget over the real API, connected to the
 * host page through the existing quackback:* protocol.
 */
export function WidgetHost({
  base,
  params,
}: {
  base: string;
  params: URLSearchParams;
}) {
  const api = useMemo(() => createApi(base), [base]);
  const bridge = useRef<ParentBridge | null>(null);
  const [config, setConfig] = useState<Config | "off" | "error" | null>(null);
  const [active, setActive] = useState(false);
  const [locale, setLocale] = useState(params.get("locale") ?? undefined);
  /** The host app's theme choice, over the workspace setting. */
  const [hostTheme, setHostTheme] = useState<"auto" | "light" | "dark">();
  const [pending, setPending] =
    useState<ReturnType<typeof navigationFor>>(null);
  const [navigation, setNavigation] = useState<Navigation>();
  /** The board of the latest new-post deep link; posts go to it when the visitor can see it. */
  const [composeBoard, setComposeBoard] = useState<string>();
  /** The launcher badge: unread replies and updates, plus unread activity. */
  const unread = useRef({ data: 0, activity: 0 });
  const postUnread = () =>
    bridge.current?.post({
      type: "quackback:unread",
      count: unread.current.data + unread.current.activity,
    });
  /** The host app's metadata and the page URL, from the SDK. */
  const [context, setContext] = useState<Record<string, string>>({});
  const capture = useHostCapture(bridge);
  const visitor = useWidgetSession(api, (user) =>
    bridge.current?.post({ type: "quackback:auth-change", user }),
  );

  const loadConfig = async () => {
    setConfig(null);
    try {
      const [{ config: stored }, capabilities] = await Promise.all([
        api.request<{
          config: {
            tabs: Surfaces & { home?: boolean };
            theme: { themeMode: "light" | "dark" | "user" };
            // Missing from an older API.
            replyTime?: Config["replyTime"];
            home?: { greeting: string | null; subtitle: string | null };
            ai?: boolean;
          } | null;
        }>("GET", "/widget/config.json"),
        api.request<{ chat: { pollIntervalMs: number } }>(
          "GET",
          "/widget/capabilities",
        ),
      ]);
      if (!stored) return setConfig("off");
      const { feedback, changelog, help, messenger, home } = stored.tabs;
      const mode = stored.theme.themeMode;
      const on: Record<WidgetTab, boolean> = {
        home: home !== false,
        messages: messenger,
        help,
        feedback,
        updates: changelog,
      };
      setConfig({
        theme: mode === "user" ? "auto" : mode,
        replyTime: stored.replyTime ?? null,
        greeting: {
          title: stored.home?.greeting ?? null,
          subtitle: stored.home?.subtitle ?? null,
        },
        surfaces: { feedback, changelog, help, messenger },
        tabs: (Object.keys(on) as WidgetTab[]).filter((tab) => on[tab]),
        pollIntervalMs: Math.max(5000, capabilities.chat.pollIntervalMs),
        ai: stored.ai === true,
      });
    } catch (error) {
      setConfig(
        error instanceof ApiError && error.status === 404 ? "off" : "error",
      );
    }
  };

  // Each message handler reads the latest render through this ref.
  const handle = useRef<(message: ParentMessage) => void>(() => {});
  handle.current = (message) => {
    if (message.type === "locale") setLocale(message.locale);
    if (message.type === "theme") setHostTheme(message.theme);
    if (message.type === "metadata") setContext(message.metadata);
    if (message.type === "capture") capture.receive(message.id, message.image);
    if (message.type === "identify")
      void visitor.identify(message.identity).then((result) =>
        bridge.current?.post({
          type: "quackback:identify-result",
          ...result,
        }),
      );
    if (message.type === "open") {
      setActive(true);
      visitor.activate();
      const next = navigationFor(message.target);
      if (next) setPending(next);
    }
  };
  useEffect(() => {
    void loadConfig();
    const parent = createParentBridge((message) => handle.current(message));
    bridge.current = parent;
    parent.ready();
    // Consume signed email continuation fragment (#319) and scrub it from URL history immediately.
    const hash = window.location.hash;
    const resumeMatch = /(?:^#|&)quills_resume=([^&]+)/.exec(hash);
    const resumeAbort = new AbortController();
    if (resumeMatch?.[1]) {
      const resumeToken = decodeURIComponent(resumeMatch[1]);
      try {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      } catch {
        // ignore sandboxed history errors
      }
      void api
        .resumeConversation(resumeToken, resumeAbort.signal)
        .then((res) => {
          setActive(true);
          visitor.resume(res.sessionToken);
          setPending(
            navigationFor({
              view: "messages",
              conversationId: res.conversationId,
            }),
          );
        })
        .catch(() => {
          // expired or invalid token falls back silently
        });
    }
    return () => {
      resumeAbort.abort();
      parent.dispose();
    };
    // The page mounts once per iframe load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = typeof config === "object" && config !== null;
  // Keep visitor presence warm while the messenger is open & visible so offline emails pause (#319).
  useEffect(() => {
    if (!active || !ready || !visitor.session || !config.surfaces.messenger) {
      return;
    }
    const streamKey = `widget-${Math.random().toString(36).slice(2, 10)}`;
    const abort = new AbortController();
    const beat = () => {
      if (document.visibilityState === "hidden") return;
      void api.heartbeatPresence(streamKey, abort.signal).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, 25_000);
    return () => {
      window.clearInterval(timer);
      abort.abort();
    };
  }, [active, ready, visitor.session, config, api]);
  const data = useWidgetData({
    api,
    session: ready ? visitor.session : null,
    active,
    surfaces: ready
      ? config.surfaces
      : { feedback: false, changelog: false, help: false, messenger: false },
    locale,
    board: params.get("board") ?? undefined,
    composeBoard,
    pollIntervalMs: ready ? config.pollIntervalMs : 10_000,
    context,
    ai: ready && config.ai,
    host: {
      event: (name, payload) =>
        bridge.current?.post({
          type: "quackback:event",
          name,
          payload,
        } as OutboundMessage),
      unread: (count) => {
        unread.current.data = count;
        postUnread();
      },
      announce: (entry, open) =>
        bridge.current?.post({
          type: "quackback:announce",
          entryId: entry.id,
          title: entry.title,
          open,
        }),
      expired: visitor.expire,
    },
  });

  const survey = useWidgetSurvey(api, ready ? visitor.session : null, active);
  const contact = useWidgetContactEmail(
    api,
    ready ? visitor.session : null,
    visitor.identified,
    active,
    ready && config.surfaces.messenger,
    (email) =>
      bridge.current?.post({
        type: "quackback:event",
        name: "email-submitted",
        payload: { email },
      }),
  );
  const activity = useWidgetActivity(
    api,
    ready ? visitor.session : null,
    visitor.identified,
    active,
    (count) => {
      unread.current.activity = count;
      postUnread();
    },
  );

  const updatesSubscription = useUpdatesSubscription(
    api,
    ready ? visitor.session : null,
    visitor.identified,
    active && ready && config.surfaces.changelog,
  );

  const team = useWidgetTeam(
    api,
    active && ready && config.surfaces.messenger,
    (presence) =>
      bridge.current?.post({
        type: "quackback:event",
        name: "presence",
        payload: presence,
      }),
  );

  // Apply a deep link once the data it points at has loaded.
  useEffect(() => {
    if (!pending || data.loadState !== "ready") return;
    setPending(null);
    const { article, board, ...next } = pending;
    if (next.composer === "feedback") setComposeBoard(board);
    if (!article) return setNavigation(next);
    void loadArticle(api, article, locale)
      .then((found) => setNavigation({ tab: "help", detail: found.id }))
      .catch(() => setNavigation({ tab: "help" }));
  }, [pending, data.loadState, api, locale]);

  // A right-to-left language lays the panel out right to left (issue #117).
  const dir = directionOf(locale ?? globalThis.navigator?.language ?? "en");
  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
  }, [dir]);

  const helpWrites = useMemo(() => writes(api), [api]);
  const onSearchHelp = useCallback(
    async (queryText: string, signal?: AbortSignal) => {
      const res = await helpWrites.searchHelp(
        queryText,
        locale ?? undefined,
        signal,
      );
      return {
        queryId: res.queryId,
        articles: res.articles.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category.name,
          body: item.snippet || item.description || "",
        })),
      };
    },
    [helpWrites, locale],
  );
  const onSearchHelpClick = useCallback(
    (queryId: string, articleId: string) => {
      void helpWrites.recordHelpSearchClick(queryId, articleId).catch(() => {});
    },
    [helpWrites],
  );

  const close = () => bridge.current?.post({ type: "quackback:close" });
  if (config === "off") return <Unavailable onClose={close} />;
  return (
    <WidgetView
      key={visitor.visitor}
      // Without a locale from the host page, the visitor's browser language.
      locale={locale ?? navigator.language}
      dir={dir}
      identified={visitor.identified}
      theme={hostTheme ?? (ready ? config.theme : "auto")}
      // Until the config arrives no tab is known to be on.
      tabs={ready ? config.tabs : []}
      onClose={close}
      closable={params.get("inline") !== "1"}
      onExpandedChange={(expanded) =>
        bridge.current?.post({ type: "quackback:expand", expanded })
      }
      navigation={navigation}
      {...(visitor.portal && {
        onOpenPortal: () =>
          (visitor.portal === "sign-in"
            ? openPortalSignedIn(api, base).then(() => "opened" as const)
            : api.sendPortalLink()
          ).catch((error: unknown) => {
            // A portal sign-in linked this profile and ended its session: identify again.
            if (error instanceof ApiError && error.status === 401)
              visitor.expire(visitor.session);
            throw error;
          }),
      })}
      {...(visitor.identified && {
        onChangeAvatar: (file: File | null) =>
          file
            ? squareAvatar(file).then((square) => uploadAvatar(api, square))
            : removeAvatar(api),
      })}
      {...survey}
      {...activity}
      {...contact}
      {...updatesSubscription}
      {...team}
      {...(ready && {
        replyTime: config.replyTime ?? undefined,
        greeting: config.greeting,
      })}
      onSearchHelp={onSearchHelp}
      onSearchHelpClick={onSearchHelpClick}
      {...data}
      // Images go with feedback and messages, from a visitor that the host app identified: the
      // upload routes refuse an anonymous session (RFC 0003 feature 6). The camera is feedback only.
      {...(data.onSubmitFeedback &&
        visitor.identified && {
          attachmentsEnabled: data.onSendMessage
            ? (true as const)
            : ("feedback" as const),
          // The SDK in the parent page renders it; a page that is not framed has no parent.
          ...(window.parent !== window && {
            onCaptureScreenshot: capture.request,
          }),
        })}
      {...(config === "error" || visitor.failed
        ? {
            loadState: "error" as const,
            onRetryLoad: async () => {
              if (config === "error") await loadConfig();
              else await visitor.establish();
            },
          }
        : !ready || visitor.session === null
          ? { loadState: "loading" as const }
          : {})}
    />
  );
}
