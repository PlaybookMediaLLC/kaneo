import { type MouseEvent, useEffect, useRef } from "react";

/**
 * The link behavior of an inbox row: a plain click opens the item in the app, a modified or
 * middle click is left to the browser, and the selected row scrolls into view.
 */
export function useRowLink(onOpen: () => void, selected = false) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    onOpen();
  };
  return {
    ref,
    onClick,
    "aria-current": selected ? ("true" as const) : undefined,
  };
}
