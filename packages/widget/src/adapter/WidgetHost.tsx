import { useEffect, useMemo, useRef, useState } from "react";
import { WidgetView } from "../ui/WidgetView.js";
import { ApiError, createApi } from "./api.js";
import {
  createParentBridge,
  type ParentBridge,
  type ParentMessage,
} from "./bridge.js";
import { loadArticle, type Surfaces } from "./load.js";
import { useWidgetSurvey } from "./surveys.js";
import { Unavailable } from "./Unavailable.js";
import { useWidgetData } from "./useWidgetData.js";
import { useWidgetSession } from "./useWidgetSession.js";
import type { OutboundMessage } from "../core/protocol.js";
import type { WidgetViewProps } from "../ui/types.js";

type Config = {
  theme: "light" | "dark" | "auto";
  surfaces: Surfaces;
  pollIntervalMs: number;
};
type Target = Extract<ParentMessage, { type: "open" }>["target"];
type Navigation = NonNullable<WidgetViewProps["navigation"]>;

/** A deep link as a view request. `articleId` may be a slug, so the host resolves it first. */
function navigationFor(
  target: Target,
): (Omit<Navigation, "detail"> & { detail?: string; article?: string }) | null {
  if (target.postId) return { tab: "feedback", detail: target.postId };
  if (target.articleId) return { tab: "help", article: target.articleId };
  switch (target.view) {
    case "new-post":
      return { tab: "feedback", composer: "feedback" };
    case "changelog":
      return { tab: "updates", detail: target.entryId };
    case "help":
      return { tab: "help" };
    case "chat":
    case "messages":
    case "tickets":
      return { tab: "messages" };
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
  const [pending, setPending] =
    useState<ReturnType<typeof navigationFor>>(null);
  const [navigation, setNavigation] = useState<Navigation>();
  const visitor = useWidgetSession(api, (user) =>
    bridge.current?.post({ type: "quackback:auth-change", user }),
  );

  const loadConfig = async () => {
    setConfig(null);
    try {
      const [{ config: stored }, capabilities] = await Promise.all([
        api.request<{
          config: {
            tabs: Surfaces;
            theme: { themeMode: "light" | "dark" | "user" };
          } | null;
        }>("GET", "/widget/config.json"),
        api.request<{ chat: { pollIntervalMs: number } }>(
          "GET",
          "/widget/capabilities",
        ),
      ]);
      if (!stored) return setConfig("off");
      const { feedback, changelog, help, messenger } = stored.tabs;
      const mode = stored.theme.themeMode;
      setConfig({
        theme: mode === "user" ? "auto" : mode,
        surfaces: { feedback, changelog, help, messenger },
        pollIntervalMs: Math.max(5000, capabilities.chat.pollIntervalMs),
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
    return () => parent.dispose();
    // The page mounts once per iframe load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = typeof config === "object" && config !== null;
  const data = useWidgetData({
    api,
    session: ready ? visitor.session : null,
    active,
    surfaces: ready
      ? config.surfaces
      : { feedback: false, changelog: false, help: false, messenger: false },
    locale,
    board: params.get("board") ?? undefined,
    pollIntervalMs: ready ? config.pollIntervalMs : 10_000,
    host: {
      event: (name, payload) =>
        bridge.current?.post({
          type: "quackback:event",
          name,
          payload,
        } as OutboundMessage),
      unread: (count) =>
        bridge.current?.post({ type: "quackback:unread", count }),
      expired: visitor.expire,
    },
  });

  const survey = useWidgetSurvey(api, ready ? visitor.session : null, active);

  // Apply a deep link once the data it points at has loaded.
  useEffect(() => {
    if (!pending || data.loadState !== "ready") return;
    setPending(null);
    const { article, ...next } = pending;
    if (!article) return setNavigation(next);
    void loadArticle(api, article, locale)
      .then((found) => setNavigation({ tab: "help", detail: found.id }))
      .catch(() => setNavigation({ tab: "help" }));
  }, [pending, data.loadState, api, locale]);

  const close = () => bridge.current?.post({ type: "quackback:close" });
  if (config === "off") return <Unavailable onClose={close} />;
  return (
    <WidgetView
      key={visitor.visitor}
      theme={ready ? config.theme : "auto"}
      onClose={close}
      onExpandedChange={(expanded) =>
        bridge.current?.post({ type: "quackback:expand", expanded })
      }
      navigation={navigation}
      {...survey}
      {...data}
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
