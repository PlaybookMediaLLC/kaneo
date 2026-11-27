import type {
  OpenOptions,
  WidgetUser,
  EventName,
  EventHandler,
} from "../types.js";
import { createEmitter } from "./events.js";
import {
  createBridge,
  type Bridge,
  type OutboundMessage,
} from "./postmessage.js";
import { createLauncher, type LauncherHandle } from "./launcher.js";
import { createPanel, type PanelHandle } from "./panel.js";
import {
  fetchServerConfig,
  serverConfigSchema,
  widgetBase,
  type ServerConfig,
} from "./config.js";
import { createTracker, type Tracker } from "./tracker.js";
import { clearDeviceId, getOrCreateDeviceId } from "./device.js";
import { removeStyles } from "./style.js";
import { privacyOptedOut } from "./privacy.js";
import { capturePage } from "./capture.js";
import {
  initOptionsSchema,
  identitySchema,
  isSafeHttpUrl,
  themeSchema,
  type RuntimeInitOptions,
} from "./options.js";
import type { EventMap } from "./protocol.js";
import { launcherCopy } from "./launcher-copy.js";

export type WidgetState = EventMap["statechange"];
export type IdentifyResult = {
  success: boolean;
  user: WidgetUser | null;
  error?: string;
  /** Token claims that Kaneo received but did not apply, such as an attribute with no definition. */
  warnings?: Array<{ code: string; field: string }>;
};
type Theme = WidgetState["theme"];

type Command =
  | "init"
  | "identify"
  | "logout"
  | "open"
  | "close"
  | "showLauncher"
  | "hideLauncher"
  | "destroy"
  | "metadata"
  | "tracking"
  | "on"
  | "off"
  | "toggle"
  | "setTheme"
  | "setLocale";

export interface SDK {
  dispatch(command: Command, arg1?: unknown, arg2?: unknown): unknown;
  isOpen(): boolean;
  getUser(): WidgetUser | null;
  isIdentified(): boolean;
  getState(): WidgetState;
}

export function createSDK(): SDK {
  let config: RuntimeInitOptions | null = null;
  // Monotonic token incremented on every init and destroy so in-flight async
  // work (config fetch, reveal fallback, idle preload) stays valid across
  // non-destructive config updates like setLocale() or showLauncher().
  let initGeneration = 0;
  let launcher: LauncherHandle | null = null;
  let panel: PanelHandle | null = null;
  let bridge: Bridge | null = null;
  let ready = false;
  let identifying = false;
  let configAbort: AbortController | null = null;
  let revealTimer: number | null = null;
  let loadTimer: number | null = null;
  let loadErrorCb: ((error: { code: string; message: string }) => void) | null =
    null;
  let fallbackLink: HTMLAnchorElement | null = null;
  let metadata: Record<string, string> | null = null;
  // `pendingIdentify` can be an Identity, `{anonymous: true}`, or `null` (logout).
  // `pendingIdentifyPresent` distinguishes "nothing queued" from "logout queued".
  let pendingIdentify: unknown = null;
  let pendingIdentifyPresent = false;
  let pendingOpen: OpenOptions | null = null;
  let panelOpen = false;
  let currentUser: WidgetUser | null = null;
  // Effective launcher/panel corner: the init `placement` until the server
  // config's `position` (the workspace's widget setting) overrides it.
  let placement: "left" | "right" = "right";
  let mobileMql: MediaQueryList | null = null;
  let mobileCleanup: (() => void) | null = null;
  let tracker: Tracker | null = null;
  // The host page's say on pageview tracking (for example its consent
  // banner). Tracking runs only when both the host and the instance allow it.
  let hostTracking = true;
  let analyticsConfig: { instanceUrl: string; deviceTracking: boolean } | null =
    null;
  let pendingDevice: string | null = null;
  const emitter = createEmitter();
  let unreadCount = 0;
  /** The host's theme choice (init `theme` or setTheme); null follows the workspace setting. */
  let hostTheme: Theme | null = null;
  let pendingLocale: string | null = null;
  let serverTheme: ServerConfig["theme"];
  let lastServerConfig: ServerConfig | null = null;
  let launcherHidden = false;
  let serverDisabled = false;
  let revealElapsed = false;
  /** A host element bound with `launcher: { selector }`, and its click handler. */
  let bound: { el: Element; onClick: () => void } | null = null;
  /** identify() promises: the one sent to the iframe, and the one queued behind it. */
  let sentResult: ((result: IdentifyResult) => void) | null = null;
  /** `announcements: "full"` opens an update at most once per initialization. */
  let announcedOpen = false;
  let queuedResult: ((result: IdentifyResult) => void) | null = null;

  function state(): WidgetState {
    return {
      initialized: config !== null,
      open: panelOpen,
      placement,
      theme: hostTheme ?? serverThemeMode(),
      locale: config?.locale ?? pendingLocale ?? null,
      unreadCount,
      user: currentUser,
      identified: currentUser !== null,
    };
  }
  const changed = () => emitter.emit("statechange", state());
  const fail = (code: string, message: string) =>
    emitter.emit("error", { code, message });
  function clearLoadFallback(): void {
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer);
      loadTimer = null;
    }
    if (fallbackLink) {
      fallbackLink.remove();
      fallbackLink = null;
    }
  }
  function triggerLoadError(code: string, message: string): void {
    fail(code, message);
    loadErrorCb?.({ code, message });
    if (
      config?.fallbackEmail &&
      !fallbackLink &&
      typeof document !== "undefined"
    ) {
      const a = document.createElement("a");
      a.href = `mailto:${config.fallbackEmail}`;
      a.textContent = "Email us instead";
      a.setAttribute("data-quills-fallback", "true");
      a.style.cssText =
        "position:fixed;bottom:20px;right:20px;z-index:2147483000;padding:10px 16px;border-radius:999px;background:#111827;color:#fff;font:500 14px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.18)";
      if (placement === "left") {
        a.style.right = "";
        a.style.left = "20px";
      }
      document.body.appendChild(a);
      fallbackLink = a;
    }
  }
  function serverThemeMode(): Theme {
    const mode = serverTheme?.themeMode ?? "user";
    return mode === "user" ? "auto" : mode;
  }

  function sendMobileState(): void {
    if (ready && bridge) bridge.send("quackback:mobile", !!mobileMql?.matches);
  }

  function iframeOrigin(): string {
    const base = widgetBase(
      config!.instanceUrl,
      config!.workspace,
      config!.baseUrl,
    );
    return new URL(base, window.location.href).origin;
  }

  /**
   * The host metadata with the page the visitor is on, for the next feedback post. The query and
   * the fragment stay out: they can hold tokens.
   */
  function sendContext(): void {
    if (!ready || !bridge) return;
    const { protocol, origin, pathname } = window.location;
    const share = config?.pageUrl ?? "path";
    bridge.send("quackback:metadata", {
      ...metadata,
      ...(/^https?:$/.test(protocol) &&
        share !== "none" && {
          pageUrl: share === "origin" ? origin : origin + pathname,
        }),
    });
  }

  /** Only the open panel asks, after the visitor pressed its capture button. */
  let capturing = false;
  async function capture(id: string): Promise<void> {
    const target = bridge;
    if (!target) return;
    let image: Blob | null = null;
    if (panelOpen && !capturing) {
      capturing = true;
      try {
        image = await capturePage(
          (element) =>
            !!element.closest(
              ".quackback-launcher, .quackback-greeting, .quackback-panel, .quackback-backdrop",
            ),
        );
      } catch {
        image = null;
      } finally {
        capturing = false;
      }
    }
    if (bridge === target)
      target.send("quackback:capture-result", { id, image });
  }

  function onIframeMessage(msg: OutboundMessage) {
    switch (msg.type) {
      case "quackback:ready":
        ready = true;
        panel?.markReady();
        flushIdentity();
        if (config?.locale) bridge!.send("quackback:locale", config.locale);
        if (hostTheme) bridge!.send("quackback:theme", hostTheme);
        sendContext();
        if (pendingDevice && hostTracking && !privacyOptedOut()) {
          bridge!.send("quackback:device", pendingDevice);
          pendingDevice = null;
        }
        if (pendingOpen) {
          bridge!.send("quackback:open", pendingOpen);
          pendingOpen = null;
        }
        sendMobileState();
        clearLoadFallback();
        emitter.emit("ready", {});
        break;
      case "quackback:close":
        dispatch("close");
        break;
      case "quackback:unread": {
        unreadCount = msg.count;
        launcher?.setUnread(msg.count);
        bound?.el.setAttribute("data-quills-unread", String(msg.count));
        emitter.emit("unread", { count: msg.count });
        changed();
        break;
      }
      case "quackback:expand":
        panel?.setExpanded(msg.expanded);
        break;
      case "quackback:identify-result": {
        if (!identifying) break;
        identifying = false;
        const settle = sentResult;
        sentResult = null;
        if (pendingIdentifyPresent) {
          // A newer identity is waiting: this result is obsolete.
          settle?.({ success: false, user: null, error: "Superseded" });
          flushIdentity();
          break;
        }
        currentUser = msg.success ? (msg.user ?? null) : null;
        emitter.emit("identify", {
          success: msg.success,
          user: currentUser,
          anonymous: msg.success && !currentUser,
          error: msg.error,
          ...(msg.warnings?.length && { warnings: msg.warnings }),
        });
        settle?.({
          success: msg.success,
          user: currentUser,
          ...(msg.error && { error: msg.error }),
          ...(msg.warnings?.length && { warnings: msg.warnings }),
        });
        if (!msg.success)
          fail("IDENTIFY_FAILED", msg.error ?? "The identity was refused");
        changed();
        break;
      }
      case "quackback:auth-change":
        if (!identifying && !pendingIdentifyPresent) currentUser = msg.user;
        break;
      case "quackback:event":
        emitter.emit(msg.name, msg.payload);
        break;
      case "quackback:capture":
        void capture(msg.id);
        break;
      case "quackback:announce": {
        emitter.emit("announcement", {
          entryId: msg.entryId,
          title: msg.title,
        });
        const mode = config?.announcements ?? "whisper";
        const target = { view: "changelog" as const, entryId: msg.entryId };
        if (mode === "none" || panelOpen) break;
        // The workspace may open each new update once (`open`); the host's `full` opens it too.
        if (msg.open || mode === "full") {
          if (!announcedOpen && document.visibilityState === "visible") {
            announcedOpen = true;
            dispatch("open", target);
          }
          break;
        }
        launcher?.announce(
          launcherCopy(config?.locale ?? navigator.language).newUpdate.replace(
            "{title}",
            msg.title,
          ),
          () => dispatch("open", target),
        );
        break;
      }
      case "quackback:navigate": {
        if (isSafeHttpUrl(msg.url)) {
          // noopener: prevent tabnabbing via window.opener on the new tab.
          // noreferrer: avoid leaking the host page URL to third parties.
          window.open(msg.url, "_blank", "noopener,noreferrer");
        }
        break;
      }
    }
  }

  // Pending idle-time panel preload (see the init case). Cancelled on
  // destroy and made moot by an early open(), which creates the panel itself.
  let panelPreload: { kind: "idle" | "timeout"; id: number } | null = null;

  function schedulePanelPreload(): void {
    if (panel || panelPreload) return;
    const w = window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
    };
    const gen = initGeneration;
    const run = () => {
      if (!config || initGeneration !== gen) return;
      panelPreload = null;
      if (config && !panel) ensurePanel();
    };
    if (typeof w.requestIdleCallback === "function") {
      panelPreload = {
        kind: "idle",
        id: w.requestIdleCallback(run, { timeout: 2500 }),
      };
    } else {
      // No requestIdleCallback (Safari): a short beat past the current task
      // keeps the iframe from racing the host page's own startup work.
      panelPreload = { kind: "timeout", id: window.setTimeout(run, 200) };
    }
  }

  function cancelPanelPreload(): void {
    if (!panelPreload) return;
    const w = window as Window & { cancelIdleCallback?: (id: number) => void };
    if (
      panelPreload.kind === "idle" &&
      typeof w.cancelIdleCallback === "function"
    ) {
      w.cancelIdleCallback(panelPreload.id);
    } else if (panelPreload.kind === "timeout") {
      window.clearTimeout(panelPreload.id);
    }
    panelPreload = null;
  }

  function ensurePanel(): PanelHandle {
    if (panel) return panel;
    cancelPanelPreload();
    const container = config!.container
      ? (document.querySelector(config!.container) ?? undefined)
      : undefined;
    const base = widgetBase(
      config!.instanceUrl,
      config!.workspace,
      config!.baseUrl,
    );
    panel = createPanel({
      widgetUrl: config!.baseUrl ? `${base}/` : base,
      placement,
      defaultBoard: config!.defaultBoard,
      container,
      // The open panel covers the launcher; closing belongs inside the iframe. Inline has neither.
      showCloseButton: !container,
      locale: config!.locale,
      onBackdropClick: () => dispatch("close"),
    });
    if (
      !ready &&
      loadTimer === null &&
      (loadErrorCb || config!.fallbackEmail)
    ) {
      const timeoutMs = config!.loadTimeoutMs ?? 3000;
      const gen = initGeneration;
      loadTimer = window.setTimeout(() => {
        loadTimer = null;
        if (config && initGeneration === gen && !ready) {
          triggerLoadError(
            "LOAD_TIMEOUT",
            `Widget did not load within ${timeoutMs}ms`,
          );
        }
      }, timeoutMs);
    }
    bridge = createBridge({
      getIframe: () => panel?.iframe ?? null,
      origin: iframeOrigin(),
    });
    bridge.onMessage(onIframeMessage);
    mobileMql = window.matchMedia("(max-width: 760px)");
    const mql = mobileMql;
    mql.addEventListener("change", sendMobileState);
    const onPopState = () => {
      if (panelOpen || config?.container) sendContext();
    };
    window.addEventListener("popstate", onPopState);
    mobileCleanup = () => {
      mql.removeEventListener("change", sendMobileState);
      window.removeEventListener("popstate", onPopState);
    };
    return panel;
  }

  function flushIdentity(): void {
    if (!ready || !bridge || identifying || !pendingIdentifyPresent) return;
    const identity = pendingIdentify;
    pendingIdentify = null;
    pendingIdentifyPresent = false;
    identifying = true;
    sentResult = queuedResult;
    queuedResult = null;
    try {
      bridge.send("quackback:identify", identity);
    } catch (error) {
      identifying = false;
      throw error;
    }
  }

  function sendIdentity(data: unknown): Promise<IdentifyResult> {
    currentUser = null;
    // Only the latest queued identity is sent; an older queued one settles as superseded.
    queuedResult?.({ success: false, user: null, error: "Superseded" });
    const result = new Promise<IdentifyResult>((resolve) => {
      queuedResult = resolve;
    });
    pendingIdentify = data;
    pendingIdentifyPresent = true;
    flushIdentity();
    return result;
  }

  function applyServerTheme(serverCfg: ServerConfig) {
    serverTheme = serverCfg.theme;
    if (!launcher || !serverCfg.theme) return;
    const t = serverCfg.theme;
    const themeMode = hostTheme
      ? hostTheme === "auto"
        ? "user"
        : hostTheme
      : (t.themeMode ?? "user");
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = themeMode === "dark" || (themeMode === "user" && prefersDark);
    const backgroundColor =
      (dark ? (t.darkPrimary ?? t.lightPrimary) : t.lightPrimary) ?? undefined;
    const foregroundColor =
      (dark
        ? (t.darkPrimaryForeground ?? t.lightPrimaryForeground)
        : t.lightPrimaryForeground) ?? undefined;
    launcher.setColors({ backgroundColor, foregroundColor });
  }

  // Reveal the launcher only after brand colors are set (or via the fallback
  // if the config fetch is slow/fails), so users never see the default color
  // flash before the brand color lands.
  const LAUNCHER_REVEAL_FALLBACK_MS = 1800;
  /** Only the current initialization may apply server-controlled state. */
  function applyServerConfig(serverConfig: ServerConfig, gen: number): void {
    if (!config || initGeneration !== gen) return;
    lastServerConfig = serverConfig;
    applyServerTheme(serverConfig);
    launcher?.setGreeting(serverConfig.launcherGreeting);
    launcher?.setLabel(serverConfig.launcherLabel);
    if (serverConfig.position) {
      placement = serverConfig.position;
      launcher?.setPlacement(placement);
      panel?.setPlacement(placement);
    }
    // Host-page pageview tracking is instance-controlled: it starts only when
    // the server config enables visitor analytics, and only if this init is
    // still the live one. The durable device id is a separate opt-in on top.
    if (serverConfig.visitorAnalytics === true && config.instanceUrl) {
      analyticsConfig = {
        instanceUrl: config.instanceUrl,
        deviceTracking: serverConfig.visitorDeviceTracking === true,
      };
      startTracking();
    }
  }

  function startTracking(): void {
    // A running tracker is left alone: restarting it would count the current
    // page again.
    if (!hostTracking || !analyticsConfig || tracker || privacyOptedOut())
      return;
    const deviceId = analyticsConfig.deviceTracking
      ? getOrCreateDeviceId()
      : null;
    tracker = createTracker(analyticsConfig.instanceUrl, deviceId);
    try {
      tracker.start();
    } catch {
      stopTracking();
      return;
    }
    // The iframe links the device to the session's principal; queue
    // until the panel reports ready if it hasn't yet.
    if (deviceId) {
      if (ready && bridge) bridge.send("quackback:device", deviceId);
      else pendingDevice = deviceId;
    }
  }

  function stopTracking(): void {
    tracker?.stop();
    tracker = null;
    pendingDevice = null;
  }

  function queryEl(selector: string): Element | null {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function createLauncherIfNeeded(): LauncherHandle | null {
    if (
      launcher ||
      bound ||
      !config ||
      config.launcher === false ||
      config.container
    )
      return launcher;
    if (typeof config.launcher === "object") {
      // The host's own element opens the widget, with the unread count as a data attribute.
      const el = queryEl(config.launcher.selector);
      if (!el) {
        fail(
          "LAUNCHER_NOT_FOUND",
          `No element matches ${config.launcher.selector}`,
        );
        return null;
      }
      const onClick = () => dispatch("toggle");
      el.addEventListener("click", onClick);
      if (unreadCount > 0)
        el.setAttribute("data-quills-unread", String(unreadCount));
      bound = { el, onClick };
      return null;
    }
    launcher = createLauncher({
      placement,
      offset: config.offset,
      locale: config.locale,
      onClick: () => dispatch("toggle"),
    });
    if (launcherHidden) launcher.setHidden(true);
    return launcher;
  }

  function dispatch(cmd: Command, a?: unknown, b?: unknown): unknown {
    switch (cmd) {
      case "init": {
        const next = initOptionsSchema.parse(a);
        if (next.container && !queryEl(next.container))
          return fail(
            "CONTAINER_NOT_FOUND",
            `No element matches ${next.container}`,
          );
        if (typeof next.launcher === "object") {
          try {
            document.querySelector(next.launcher.selector);
          } catch {
            return fail(
              "INVALID_OPTIONS",
              `Invalid launcher selector: ${next.launcher.selector}`,
            );
          }
        }
        // Validate before destroy so a bad re-init leaves the working instance intact.
        if (config) dispatch("destroy");
        const gen = ++initGeneration;
        serverDisabled = false;
        revealElapsed = false;
        const resolvedLocale = next.locale ?? pendingLocale ?? undefined;
        pendingLocale = resolvedLocale ?? null;
        config = resolvedLocale ? { ...next, locale: resolvedLocale } : next;
        loadErrorCb =
          a &&
          typeof a === "object" &&
          typeof (a as { onLoadError?: unknown }).onLoadError === "function"
            ? (
                a as {
                  onLoadError: (e: { code: string; message: string }) => void;
                }
              ).onLoadError
            : null;
        if (next.theme !== undefined) hostTheme = next.theme;
        announcedOpen = false;
        // Only an explicit option changes the host's choice, so a withdrawal
        // made before init, or before a re-init, is never silently undone.
        if (next.tracking !== undefined) hostTracking = next.tracking;
        if (!hostTracking) clearDeviceId();
        placement = next.placement ?? "right";
        createLauncherIfNeeded();
        // Preload the hidden panel iframe off the host page's critical path:
        // init typically runs while the host is still loading, and the iframe
        // immediately competes for its bandwidth. An open() before the idle
        // slot fires still creates the panel on the spot.
        // Inline, the widget shows at once, in the host element.
        if (next.container) dispatch("open");
        else schedulePanelPreload();
        if (config.identity !== undefined) {
          sendIdentity(config.identity);
        } else if (!pendingIdentifyPresent && !identifying) {
          sendIdentity({ anonymous: true });
        }
        const reveal = () => {
          if (initGeneration !== gen) return;
          revealElapsed = true;
          launcher?.reveal();
        };
        const baked = window.__QUACKBACK_CONFIG__;
        const bakedMatches =
          !window.__QUACKBACK_URL__ ||
          window.__QUACKBACK_URL__ === next.instanceUrl;
        if (baked !== undefined && bakedMatches) {
          const parsed = serverConfigSchema.safeParse(baked);
          applyServerConfig(parsed.success ? parsed.data : {}, gen);
          reveal();
        } else {
          const controller = new AbortController();
          configAbort = controller;
          const fallback = window.setTimeout(
            reveal,
            LAUNCHER_REVEAL_FALLBACK_MS,
          );
          revealTimer = fallback;
          void fetchServerConfig(
            next.instanceUrl,
            next.workspace,
            controller.signal,
            next.baseUrl,
          )
            .then((serverConfig) => {
              if (serverConfig) return applyServerConfig(serverConfig, gen);
              // The widget is off or the workspace does not exist: remove the launcher and cancel
              // any idle panel preload, but keep `config` so an explicit host `open()` still shows
              // the unavailable panel.
              if (initGeneration !== gen) return;
              serverDisabled = true;
              if (bound) {
                bound.el.removeEventListener("click", bound.onClick);
                bound.el.removeAttribute("data-quills-unread");
                bound = null;
              }
              cancelPanelPreload();
              if (!panelOpen) {
                mobileCleanup?.();
                mobileCleanup = null;
                mobileMql = null;
                panel?.destroy();
                panel = null;
                bridge?.dispose();
                bridge = null;
                ready = false;
                identifying = false;
                for (const settle of [sentResult, queuedResult])
                  settle?.({
                    success: false,
                    user: null,
                    error: "Widget disabled",
                  });
                sentResult = null;
                queuedResult = null;
                pendingIdentify = null;
                pendingIdentifyPresent = false;
              }
              launcher?.remove();
              launcher = null;
              fail("WIDGET_DISABLED", "The widget is off for this workspace");
            })
            .finally(() => {
              window.clearTimeout(fallback);
              if (initGeneration !== gen) return;
              configAbort = null;
              revealTimer = null;
              reveal();
            });
        }
        return;
      }
      case "identify":
        return sendIdentity(identitySchema.parse(a ?? { anonymous: true }));
      case "logout":
        launcher?.setOpen(false);
        panel?.hide();
        panelOpen = false;
        currentUser = null;
        void sendIdentity(null);
        changed();
        return;
      case "open": {
        // open before init is a no-op, matching close/hide
        if (!config) return fail("NOT_READY", "Call init before open");
        const opts = (a as OpenOptions) ?? {};
        // The page may have changed since the last open in a single-page app.
        sendContext();
        if (ready && bridge) bridge.send("quackback:open", opts);
        else pendingOpen = opts;
        // The idle preload may not have fired yet — create the panel now.
        ensurePanel().show();
        launcher?.setOpen(true);
        panelOpen = true;
        const ctx = opts as {
          view?:
            | "home"
            | "new-post"
            | "changelog"
            | "help"
            | "chat"
            | "messages"
            | "tickets"
            | "notifications";
          postId?: string;
          articleId?: string;
          entryId?: string;
        };
        emitter.emit("open", {
          view: ctx.view,
          postId: ctx.postId,
          articleId: ctx.articleId,
          entryId: ctx.entryId,
        });
        changed();
        return;
      }
      case "close":
        if (config?.container) return;
        launcher?.setOpen(false);
        panel?.hide();
        panelOpen = false;
        emitter.emit("close", {});
        changed();
        return;
      case "toggle":
        return dispatch(panelOpen ? "close" : "open");
      case "setTheme": {
        const theme = themeSchema.safeParse(a);
        if (!theme.success)
          return fail(
            "INVALID_OPTIONS",
            "The theme must be auto, light or dark",
          );
        hostTheme = theme.data;
        if (serverTheme) applyServerTheme({ theme: serverTheme });
        if (ready && bridge) bridge.send("quackback:theme", theme.data);
        changed();
        return;
      }
      case "setLocale": {
        if (typeof a !== "string" || !a || a.length > 35)
          return fail("INVALID_OPTIONS", "The locale must be a language tag");
        pendingLocale = a;
        if (config) config = { ...config, locale: a };
        if (ready && bridge) bridge.send("quackback:locale", a);
        launcher?.setLocale(a);
        panel?.setLocale(a);
        changed();
        return;
      }
      case "showLauncher":
        launcherHidden = false;
        if (serverDisabled) return;
        if (!launcher) {
          if (config?.launcher === false)
            config = { ...config, launcher: true };
          const created = createLauncherIfNeeded();
          if (created) {
            if (unreadCount > 0) created.setUnread(unreadCount);
            if (panelOpen) created.setOpen(true);
            if (lastServerConfig) {
              applyServerTheme(lastServerConfig);
              created.setGreeting(lastServerConfig.launcherGreeting);
              created.setLabel(lastServerConfig.launcherLabel);
              created.reveal();
            } else if (!configAbort || revealElapsed) {
              created.reveal();
            }
          }
        } else {
          launcher.setHidden(false);
        }
        return;
      case "hideLauncher":
        launcherHidden = true;
        launcher?.setHidden(true);
        return;
      case "on":
        return emitter.on(a as EventName, b as EventHandler<EventName>);
      case "off":
        emitter.off(a as EventName, b as EventHandler<EventName> | undefined);
        return;
      case "metadata": {
        const patch = a as Record<string, string | null>;
        metadata = metadata ?? {};
        for (const k of Object.keys(patch)) {
          const v = patch[k];
          if (v === null) delete metadata[k];
          else metadata[k] = String(v);
        }
        sendContext();
        return;
      }
      case "tracking":
        hostTracking = a === true;
        if (hostTracking) startTracking();
        else {
          // Withdrawn consent also removes the stored device id.
          stopTracking();
          clearDeviceId();
          // The panel keeps the id it was given for linking sessions to the
          // device; a null tells it to drop it.
          if (ready && bridge) bridge.send("quackback:device", null);
        }
        return;
      case "destroy":
        if (bound) {
          bound.el.removeEventListener("click", bound.onClick);
          bound.el.removeAttribute("data-quills-unread");
        }
        bound = null;
        for (const settle of [sentResult, queuedResult])
          settle?.({ success: false, user: null, error: "Destroyed" });
        sentResult = null;
        queuedResult = null;
        unreadCount = 0;
        hostTheme = null;
        pendingLocale = null;
        serverTheme = undefined;
        lastServerConfig = null;
        launcherHidden = false;
        serverDisabled = false;
        revealElapsed = false;
        initGeneration += 1;
        config = null;
        configAbort?.abort();
        configAbort = null;
        if (revealTimer !== null) window.clearTimeout(revealTimer);
        revealTimer = null;
        clearLoadFallback();
        loadErrorCb = null;
        cancelPanelPreload();
        panel?.destroy();
        launcher?.remove();
        bridge?.dispose();
        stopTracking();
        analyticsConfig = null;
        mobileCleanup?.();
        mobileCleanup = null;
        mobileMql = null;
        removeStyles();
        panel = null;
        launcher = null;
        bridge = null;
        ready = false;
        identifying = false;
        metadata = null;
        pendingIdentify = null;
        pendingIdentifyPresent = false;
        pendingOpen = null;
        panelOpen = false;
        currentUser = null;
        placement = "right";
        changed();
        return;
    }
  }

  return {
    dispatch,
    isOpen: () => panelOpen,
    getUser: () => currentUser,
    isIdentified: () => currentUser !== null,
    getState: state,
  };
}
