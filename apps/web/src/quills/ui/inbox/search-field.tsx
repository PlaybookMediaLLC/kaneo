import { Search } from "lucide-react";
import { useRef } from "react";
import { cn, Kbd } from "../upstream";
import { useKeyShortcuts } from "./use-key-shortcuts";

export interface SearchFieldProps {
  /** The accessible name and the placeholder, such as "Search conversations…". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** "/" focuses the field. Set false for a second field on the same page. */
  shortcut?: boolean;
  className?: string;
}

const KEY = "/";

/** The rounded gray search field of a list, with the "/" key hint. */
export function SearchField({
  label,
  value,
  onChange,
  shortcut = true,
  className,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  useKeyShortcuts({ [KEY]: () => input.current?.focus() }, shortcut);
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-lg bg-muted px-2.5 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <input
        ref={input}
        type="search"
        aria-label={label}
        aria-keyshortcuts={shortcut ? KEY : undefined}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {shortcut ? (
        <Kbd aria-hidden="true" tone="muted">
          {KEY}
        </Kbd>
      ) : null}
    </div>
  );
}
