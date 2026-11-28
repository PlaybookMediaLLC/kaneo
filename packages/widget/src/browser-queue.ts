/**
 * IIFE entry for script-tag users.
 *
 * The inline snippet on the host page creates a stub `window.Quills` that
 * pushes every call into a queue. This module replaces that stub with a live
 * dispatcher backed by `createSDK`, then replays anything already queued.
 * Snippets pasted before the rename use `window.Quackback`; that stub is
 * drained and replaced too, so those sites keep working.
 *
 * Kaneo serves this file verbatim at `/api/quills-public/{workspace}/widget/sdk.js`,
 * so the instance URL and workspace come from the script's own URL. A server
 * may instead prepend `window.__QUACKBACK_URL__` (and `window.__QUACKBACK_CONFIG__`,
 * the baked server config that lets the SDK skip the config fetch — see core/sdk.ts).
 * Script-tag installs therefore omit `instanceUrl` and `workspace` from their init
 * options — we fold the baked values into every init that doesn't carry its own. If
 * no init happens at all (a bare `<script src>` with no `Quills("init")`
 * call), we auto-dispatch one so the widget still boots.
 */
import { createSDK } from "./core/sdk.js";
import type { ServerConfig } from "./core/config.js";
import { isWorkspaceRef } from "./core/options.js";

declare global {
  interface Window {
    Quills?: ((...args: unknown[]) => unknown) & { q?: IArguments[] };
    /** The global of snippets pasted before the rename to Quills. */
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] };
    __QUACKBACK_URL__?: string;
    __QUACKBACK_CONFIG__?: ServerConfig;
  }
}

const sdk = createSDK();
const w = window;
const scriptEl =
  (document.currentScript as HTMLScriptElement | null) ??
  (document.querySelector(
    "script[data-quills-workspace]",
  ) as HTMLScriptElement | null) ??
  (document.querySelector(
    'script[src*="/api/quills-public/"][src*="/widget/sdk.js"]',
  ) as HTMLScriptElement | null) ??
  (document.querySelector(
    'script[data-workspace][src*="sdk.js"]',
  ) as HTMLScriptElement | null) ??
  (document.querySelector(
    'script[src*="/widget/sdk.js"]',
  ) as HTMLScriptElement | null);
// Kaneo serves this bundle at {instanceUrl}/api/quills-public/{workspace}/widget/sdk.js, or via
// a custom widget domain / reverse proxy at {baseUrl}/sdk.js (#318). Hosts behind a custom proxy
// path or dynamic loader can also pass data-instance-url and data-workspace on the script tag.
const served =
  /^(https?:\/\/[^/]+(?:\/[^?#]*?)?)\/api\/quills-public\/([A-Za-z0-9_-]+)\/widget\/sdk\.js(?:[?#]|$)/.exec(
    scriptEl?.src ?? "",
  );
const rawDataUrl = (
  scriptEl?.dataset.quillsInstanceUrl ||
  scriptEl?.dataset.instanceUrl ||
  ""
).trim();
let dataUrl: string | undefined;
if (rawDataUrl) {
  try {
    const resolved = rawDataUrl.startsWith("/")
      ? new URL(rawDataUrl, w.location.href)
      : new URL(rawDataUrl);
    if (resolved.protocol === "https:" || resolved.protocol === "http:") {
      dataUrl = `${resolved.origin}${resolved.pathname.replace(/\/+$/, "")}`;
    }
  } catch {
    dataUrl = undefined;
  }
}
const rawWorkspace = (
  scriptEl?.dataset.quillsWorkspace ||
  scriptEl?.dataset.workspace ||
  ""
).trim();
const dataWorkspace = isWorkspaceRef(rawWorkspace) ? rawWorkspace : undefined;
let scriptOrigin: string | undefined;
if (!dataUrl && !served && dataWorkspace && scriptEl?.src) {
  try {
    const parsedSrc = new URL(scriptEl.src, w.location.href);
    if (parsedSrc.protocol === "https:" || parsedSrc.protocol === "http:") {
      scriptOrigin = parsedSrc.origin;
    }
  } catch {
    scriptOrigin = undefined;
  }
}
const proxied =
  !served && !rawDataUrl && !rawWorkspace && !w.__QUACKBACK_URL__
    ? /^(https?:\/\/[^/]+(?:\/[^?#]*?)?)\/sdk\.js(?:[?#]|$)/.exec(
        scriptEl?.src ?? "",
      )
    : null;
const bakedUrl = w.__QUACKBACK_URL__ ?? dataUrl ?? served?.[1] ?? scriptOrigin;
const bakedWorkspace = dataWorkspace ?? served?.[2];
const bakedBaseUrl = proxied?.[1];

// Suppresses the deferred fallback once the host has taken explicit control:
// either by initializing (their options take precedence) or by destroying
// (they don't want a default widget spawning later).
let bootSuppressed = false;

/** State reads that the npm entry exposes as methods; the script tag answers them by name too. */
const queries = {
  isOpen: () => sdk.isOpen(),
  getUser: () => sdk.getUser(),
  isIdentified: () => sdk.isIdentified(),
  getState: () => sdk.getState(),
};

function dispatch(command: unknown, a?: unknown, b?: unknown): unknown {
  if (
    typeof command === "string" &&
    Object.prototype.hasOwnProperty.call(queries, command)
  )
    return queries[command as keyof typeof queries]();
  let options = a;
  if (command === "init" || command === "destroy") bootSuppressed = true;
  if (command === "init" && (bakedUrl || bakedWorkspace || bakedBaseUrl)) {
    const opts =
      a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    options = {
      ...opts,
      ...(!opts.instanceUrl && bakedUrl && { instanceUrl: bakedUrl }),
      ...(!opts.workspace && bakedWorkspace && { workspace: bakedWorkspace }),
      ...(!opts.baseUrl && bakedBaseUrl && { baseUrl: bakedBaseUrl }),
    };
  }
  return sdk.dispatch(command as "init", options, b);
}

// Capture any queued calls from the inline snippet before we overwrite it.
const legacy = w.Quackback !== undefined;
const queued: IArguments[] = [
  ...Array.from(w.Quills?.q ?? []),
  ...Array.from(w.Quackback?.q ?? []),
];

// Replace the queue stub with a live dispatcher. A page with the old snippet
// keeps `Quackback(...)` working for its later calls.
const live = function (...args: unknown[]) {
  return dispatch(args[0], args[1], args[2]);
};
Object.assign(live, queries);
w.Quills = live;
if (legacy) w.Quackback = live;

// Replay any queued commands.
for (const args of queued) {
  const a = args as unknown as unknown[];
  dispatch(a[0], a[1], a[2]);
}

// Deferred so an explicit `Quills("init", ...)` from host code can pre-empt
// the default-options fallback.
if (bakedBaseUrl || (bakedUrl && (bakedWorkspace || w.__QUACKBACK_URL__))) {
  setTimeout(() => {
    if (!bootSuppressed) dispatch("init", {});
  }, 0);
}
