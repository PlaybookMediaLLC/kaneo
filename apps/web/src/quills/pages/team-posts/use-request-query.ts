import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDebouncedValue } from "../../ui/upstream";

/**
 * The text of the request search field. A typed value reaches `onChange` (the address)
 * after a pause, once, so the list and the list pane share one search.
 */
export function useRequestQuery(
  initial: string | undefined,
  onChange: (query: string | undefined) => void,
) {
  const [text, setText] = useState(initial ?? "");
  const query = useDebouncedValue(text.trim(), 300);
  const sent = useRef(query);
  const latest = useRef(onChange);
  useLayoutEffect(() => {
    latest.current = onChange;
  });
  // An address change from elsewhere, such as a sidebar link, replaces the text.
  useEffect(() => {
    const value = initial ?? "";
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [initial]);
  useEffect(() => {
    if (query === sent.current) return;
    sent.current = query;
    latest.current(query || undefined);
  }, [query]);
  return [text, setText] as const;
}
