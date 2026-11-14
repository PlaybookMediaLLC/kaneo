import { useEffect, useLayoutEffect, useRef } from "react";
import { parseBinding, shortcutRegistry } from "../upstream";

/** Handlers by key, such as `{ j: next, arrowdown: next }`. A missing handler binds nothing. */
export type KeyHandlers = Record<string, (() => void) | undefined>;

/**
 * Binds single keys through Kaneo's shortcut registry. The registry ignores a key that is
 * typed in a text field or pressed in an open dialog or menu, and Enter on a focused control.
 */
export function useKeyShortcuts(handlers: KeyHandlers, enabled = true) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const keys = Object.keys(handlers)
    .filter((key) => handlers[key])
    .join(" ");
  useEffect(() => {
    if (!enabled || !keys) return;
    const release = keys.split(" ").map((key) =>
      shortcutRegistry.register({
        bindings: [parseBinding(key)],
        scope: "view",
        handler: () => latest.current[key]?.(),
      }),
    );
    return () => {
      for (const unregister of release) unregister();
    };
  }, [enabled, keys]);
}
