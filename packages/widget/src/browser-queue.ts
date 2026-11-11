/**
 * IIFE entry for script-tag users.
 *
 * The inline snippet on the host page creates a stub `window.Quackback` that
 * pushes every call into a queue. This module replaces that stub with a live
 * dispatcher backed by `createSDK`, then replays anything already queued.
 *
 * Kaneo serves this file verbatim at `/api/quills-public/{workspace}/widget/sdk.js`,
 * so the instance URL and workspace come from the script's own URL. A server
 * may instead prepend `window.__QUACKBACK_URL__` (and `window.__QUACKBACK_CONFIG__`,
 * the baked server config that lets the SDK skip the config fetch — see core/sdk.ts).
 * Script-tag installs therefore omit `instanceUrl` and `workspace` from their init
 * options — we fold the baked values into every init that doesn't carry its own. If
 * no init happens at all (a bare `<script src>` with no `Quackback("init")`
 * call), we auto-dispatch one so the widget still boots.
 */
import { createSDK } from "./core/sdk.js";
import type { ServerConfig } from "./core/config.js";

declare global {
  interface Window {
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] };
    __QUACKBACK_URL__?: string;
    __QUACKBACK_CONFIG__?: ServerConfig;
  }
}

const sdk = createSDK();
const w = window;
// Kaneo serves this bundle at {instanceUrl}/api/quills-public/{workspace}/widget/sdk.js, so a
// script-tag install carries both values in its own URL.
const served =
  /^(https?:\/\/[^/]+(?:\/[^?#]*?)?)\/api\/quills-public\/([A-Za-z0-9_-]+)\/widget\/sdk\.js(?:[?#]|$)/.exec(
    (document.currentScript as HTMLScriptElement | null)?.src ?? "",
  );
const bakedUrl = w.__QUACKBACK_URL__ ?? served?.[1];
const bakedWorkspace = served?.[2];

// Suppresses the deferred fallback once the host has taken explicit control:
// either by initializing (their options take precedence) or by destroying
// (they don't want a default widget spawning later).
let bootSuppressed = false;

function dispatch(command: unknown, a?: unknown, b?: unknown): unknown {
  let options = a;
  if (command === "init" || command === "destroy") bootSuppressed = true;
  if (command === "init" && bakedUrl) {
    const opts =
      a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    options = {
      ...opts,
      ...(!opts.instanceUrl && { instanceUrl: bakedUrl }),
      ...(!opts.workspace && bakedWorkspace && { workspace: bakedWorkspace }),
    };
  }
  return sdk.dispatch(command as "init", options, b);
}

// Capture any queued calls from the inline snippet before we overwrite Quackback.
const queued: IArguments[] = Array.from(w.Quackback?.q ?? []);

// Replace the queue stub with a live dispatcher.
w.Quackback = function (...args: unknown[]) {
  return dispatch(args[0], args[1], args[2]);
};

// Replay any queued commands.
for (const args of queued) {
  const a = args as unknown as unknown[];
  dispatch(a[0], a[1], a[2]);
}

// Deferred so an explicit `Quackback("init", ...)` from host code can pre-empt
// the default-options fallback.
if (bakedUrl) {
  setTimeout(() => {
    if (!bootSuppressed) dispatch("init", {});
  }, 0);
}
