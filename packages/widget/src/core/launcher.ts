import { ensureStyles } from "./style.js";
import { CHAT_CIRCLE, X } from "../icons/phosphor.js";
import { launcherCopy } from "./launcher-copy.js";

export interface LauncherOptions {
  placement: "left" | "right";
  /** Pixels from the bottom and the side edge; 20 by default. */
  offset?: { bottom?: number; side?: number };
  onClick: () => void;
  /**
   * Mount the button (and greeting) inside this element with absolute
   * positioning. Used by the admin live preview so the real launcher sits in
   * the fake page instead of `position: fixed` on the viewport.
   */
  root?: HTMLElement;
  /** The language of the launcher's accessible names; the browser language when unset. */
  locale?: string;
}

export interface LauncherHandle {
  el: HTMLButtonElement;
  setOpen(open: boolean): void;
  /** Replace the button colors (typically called after server config fetch). */
  setColors(colors: {
    backgroundColor?: string;
    foregroundColor?: string;
  }): void;
  /** Show an unread-count badge on the button (hidden at 0). Driven by the
   *  iframe's `quackback:unread` messages so a visitor sees waiting replies
   *  without opening the widget. */
  setUnread(count: number): void;
  /** Proactive greeting bubble beside the button (empty/unset hides it). Shown
   *  only while closed and not dismissed this browser session; clicking it opens
   *  the widget. Driven by the server config. */
  setGreeting(text: string | null | undefined): void;
  /** A one-off bubble (a new update) over the greeting; null removes it. Dismissal lasts this page. */
  announce(text: string | null, onClick?: () => void): void;
  /** Text label beside the icon — turns the circular button into a pill.
   *  Empty/unset restores the icon-only circle. Driven by the server config. */
  setLabel(text: string | null | undefined): void;
  /** Move the button (and its greeting bubble) between bottom corners. */
  setPlacement(side: "left" | "right"): void;
  /** Change the language of the launcher's accessible names. */
  setLocale(locale: string | undefined): void;
  /** Fade the button in. Called after initial colors are set to avoid a color flash. */
  reveal(): void;
  /** Hide or show both the button and any proactive greeting/announcement bubble. */
  setHidden(hidden: boolean): void;
  remove(): void;
}

// Default launcher colors — shown briefly before the server theme fetch
// completes, or as the permanent colors if the fetch fails.
const DEFAULT_BG = "#ffffff";
const DEFAULT_FG = "#171717";

const MESSENGER_ICON = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 256 256" fill="currentColor"><path d="${CHAT_CIRCLE}"/></svg>`;

export function createLauncher(opts: LauncherOptions): LauncherHandle {
  ensureStyles(opts.placement);
  const listeners = new AbortController();
  const listen = { signal: listeners.signal };
  let bg = DEFAULT_BG;
  let fg = DEFAULT_FG;
  // Unread counts only need attention while the widget is closed.
  let unreadCount = 0;
  let isOpen = false;
  let isHidden = false;
  let revealed = false;
  // Visible button label — when set, it doubles as the accessible name.
  let labelText = "";
  // Proactive greeting bubble state. Dismissal persists per browser session so
  // the bubble invites once without nagging on every page. A contained preview
  // must not write that key — it would hide the bubble for a later host visit.
  let greetingText: string | null = null;
  let announcement: { text: string; onClick: () => void } | null = null;
  let localDismissed = false;
  const contained = Boolean(opts.root);
  const edge = contained ? "0px" : `${opts.offset?.side ?? 20}px`;
  const bottom = contained ? 0 : (opts.offset?.bottom ?? 20);
  const GREETING_DISMISS_KEY = "quackback:launcher-greeting-dismissed";
  const greetingDismissed = (): boolean => {
    if (contained) return localDismissed;
    try {
      return sessionStorage.getItem(GREETING_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "quackback-launcher";
  btn.inert = true;
  Object.assign(btn.style, {
    position: contained ? "absolute" : "fixed",
    bottom: `${bottom}px`,
    [opts.placement === "left" ? "left" : "right"]: edge,
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "40px",
    height: "40px",
    padding: "0",
    border: "none",
    borderRadius: "50%",
    backgroundColor: bg,
    color: fg,
    fontSize: "14px",
    fontWeight: "600",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    cursor: "pointer",
    boxShadow:
      "inset 0 0 0 .5px rgba(0,0,0,.13), 0 1px 1.5px rgba(0,0,0,.04), 0 8px 16px rgba(0,0,0,.05)",
    opacity: "0",
    transition:
      "opacity 450ms ease, background-color 200ms cubic-bezier(0.32,0.72,0,1), transform 150ms ease-out",
  });
  let copy = launcherCopy(opts.locale ?? navigator.language);
  btn.setAttribute("aria-label", copy.open);
  btn.setAttribute("aria-expanded", "false");

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "relative",
    display: "flex",
    width: "22px",
    height: "22px",
    flexShrink: "0",
  });

  wrapper.innerHTML = MESSENGER_ICON;
  btn.appendChild(wrapper);

  // Optional text label next to the icon. Hidden until setLabel arrives with
  // the server config; the badge stays the last child either way.
  const labelSpan = document.createElement("span");
  Object.assign(labelSpan.style, {
    display: "none",
    maxWidth: "180px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  btn.appendChild(labelSpan);

  // Unread-count badge, top-right of the button. Its own colors (not the theme
  // fg/bg) so it always reads as an alert against any launcher color.
  const badge = document.createElement("span");
  Object.assign(badge.style, {
    position: "absolute",
    top: "-2px",
    right: "-2px",
    display: "none",
    minWidth: "20px",
    height: "20px",
    padding: "0 5px",
    boxSizing: "border-box",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "10px",
    backgroundColor: "#ef4444",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: "700",
    lineHeight: "1",
    boxShadow: "0 0 0 2px rgba(255,255,255,0.9)",
    pointerEvents: "none",
  });
  btn.appendChild(badge);

  const renderBadge = () => {
    const show = unreadCount > 0 && !isOpen;
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    badge.style.display = show ? "flex" : "none";
  };

  // Proactive greeting bubble — a fixed card sitting just above the button on
  // the same side. Clicking the text opens the widget; the × dismisses it for
  // the session. Its own light card colors so it reads over any launcher color.
  const side = opts.placement === "left" ? "left" : "right";
  const bubble = document.createElement("div");
  bubble.className = "quackback-greeting";
  Object.assign(bubble.style, {
    position: contained ? "absolute" : "fixed",
    bottom: `${bottom + 64}px`,
    [side]: edge,
    zIndex: "2147483646",
    display: "none",
    alignItems: "center",
    gap: "8px",
    maxWidth: "260px",
    padding: "10px 12px",
    borderRadius: "14px",
    backgroundColor: "#ffffff",
    color: "#111827",
    fontSize: "13px",
    lineHeight: "1.35",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    boxShadow: "0 12px 32px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)",
  });
  const bubbleText = document.createElement("button");
  bubbleText.type = "button";
  Object.assign(bubbleText.style, {
    cursor: "pointer",
    flex: "1",
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "start",
    padding: "0",
  });
  bubbleText.addEventListener(
    "click",
    () => {
      const open = announcement?.onClick;
      if (!open) return opts.onClick();
      // An update is announced once: the greeting comes back.
      announcement = null;
      renderGreeting();
      open();
    },
    listen,
  );
  const bubbleClose = document.createElement("button");
  bubbleClose.type = "button";
  bubbleClose.setAttribute("aria-label", copy.dismiss);
  bubbleClose.innerHTML = `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="${X}"/></svg>`;
  Object.assign(bubbleClose.style, {
    flexShrink: "0",
    width: "18px",
    height: "18px",
    padding: "0",
    border: "none",
    borderRadius: "50%",
    background: "transparent",
    color: "#9ca3af",
    fontSize: "16px",
    lineHeight: "1",
    cursor: "pointer",
  });
  const renderGreeting = () => {
    bubbleText.textContent = announcement?.text ?? greetingText ?? "";
    const show =
      !isHidden &&
      !isOpen &&
      (!!announcement || (!!greetingText && !greetingDismissed()));
    bubble.style.display = show ? "flex" : "none";
  };
  bubbleClose.addEventListener(
    "click",
    () => {
      if (announcement) {
        announcement = null;
        return renderGreeting();
      }
      if (contained) {
        localDismissed = true;
      } else {
        try {
          sessionStorage.setItem(GREETING_DISMISS_KEY, "1");
        } catch {
          /* private mode — dismiss for this page load only */
          greetingText = null;
        }
      }
      renderGreeting();
    },
    listen,
  );
  bubble.appendChild(bubbleText);
  bubble.appendChild(bubbleClose);
  const mount = opts.root ?? document.body;
  mount.appendChild(bubble);

  btn.addEventListener("click", opts.onClick, listen);

  mount.appendChild(btn);

  return {
    el: btn,
    setOpen(open) {
      isOpen = open;
      btn.style.visibility = open ? "hidden" : "visible";
      btn.inert = !revealed || open || isHidden;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        open ? copy.close : labelText || copy.open,
      );
      renderBadge();
      renderGreeting();
    },
    setColors(colors) {
      bg = colors.backgroundColor || DEFAULT_BG;
      btn.style.backgroundColor = bg;
      fg = colors.foregroundColor || DEFAULT_FG;
      btn.style.color = fg;
    },
    setUnread(count) {
      unreadCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      renderBadge();
    },
    setGreeting(text) {
      const next = text?.trim() || null;
      if (contained && next !== greetingText) localDismissed = false;
      greetingText = next;
      renderGreeting();
    },
    announce(text, onClick) {
      announcement = text && onClick ? { text, onClick } : null;
      renderGreeting();
    },
    setLabel(text) {
      labelText = text?.trim() ?? "";
      const show = labelText.length > 0;
      labelSpan.textContent = labelText;
      labelSpan.style.display = show ? "block" : "none";
      // Pill vs. icon-only circle.
      btn.style.width = show ? "auto" : "40px";
      btn.style.borderRadius = show ? "20px" : "50%";
      btn.style.padding = show ? "0 16px 0 10px" : "0";
      btn.style.gap = show ? "8px" : "0";
      if (!isOpen) btn.setAttribute("aria-label", labelText || copy.open);
    },
    setLocale(locale) {
      copy = launcherCopy(locale ?? navigator.language);
      bubbleClose.setAttribute("aria-label", copy.dismiss);
      btn.setAttribute(
        "aria-label",
        isOpen ? copy.close : labelText || copy.open,
      );
    },
    setPlacement(side) {
      btn.style.left = side === "left" ? edge : "";
      btn.style.right = side === "right" ? edge : "";
      bubble.style.left = side === "left" ? edge : "";
      bubble.style.right = side === "right" ? edge : "";
    },
    reveal() {
      revealed = true;
      btn.inert = isOpen || isHidden;
      btn.style.opacity = "1";
    },
    setHidden(hidden) {
      isHidden = hidden;
      btn.style.display = hidden ? "none" : "flex";
      btn.inert = !revealed || isOpen || hidden;
      renderGreeting();
    },
    remove() {
      listeners.abort();
      btn.remove();
      bubble.remove();
    },
  };
}
