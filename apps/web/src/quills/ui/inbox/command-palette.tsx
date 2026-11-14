import { Search } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, CommandDialog, CommandDialogPopup, Spinner } from "../upstream";

export interface CommandPaletteProps<Item> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The accessible name of the dialog, such as "Merge into". */
  label: string;
  /** A chip before the field, such as "Merge into". */
  chip?: string;
  /** Such as "Find the request to merge this into…". */
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** The results. The caller filters them, for example with a search request. */
  items: readonly Item[];
  getKey: (item: Item) => string;
  renderItem: (item: Item) => ReactNode;
  /** Runs on a click or on Enter. The caller closes the palette. */
  onSelect: (item: Item) => void;
  loading?: boolean;
}

/** A centered search over a blurred page. The arrow keys move through the results. */
export function CommandPalette<Item>(props: CommandPaletteProps<Item>) {
  const { t } = useTranslation("quills");
  const id = useId();
  const [active, setActive] = useState(0);
  const index = Math.min(active, props.items.length - 1);
  const current = props.items[index];
  const move = (offset: number) =>
    setActive(
      (index + offset + props.items.length) % Math.max(1, props.items.length),
    );
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup aria-label={props.label}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          {props.chip ? (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
              {props.chip}
            </span>
          ) : null}
          <input
            autoFocus
            role="combobox"
            aria-label={props.placeholder}
            aria-expanded={props.items.length > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={
              current ? `${id}-${props.getKey(current)}` : undefined
            }
            placeholder={props.placeholder}
            value={props.query}
            onChange={(event) => {
              setActive(0);
              props.onQueryChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") move(1);
              else if (event.key === "ArrowUp") move(-1);
              else if (event.key === "Enter" && current)
                props.onSelect(current);
              else return;
              event.preventDefault();
            }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {props.loading ? <Spinner className="size-4" /> : null}
        </div>
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={props.label}
          className="max-h-80 overflow-y-auto p-1 empty:hidden"
        >
          {props.items.map((item, position) => (
            <div
              key={props.getKey(item)}
              id={`${id}-${props.getKey(item)}`}
              role="option"
              aria-selected={position === index}
              tabIndex={-1}
              onMouseMove={() => setActive(position)}
              // Mouse down keeps the focus in the field; the keyboard selects from there.
              onMouseDown={(event) => {
                event.preventDefault();
                props.onSelect(item);
              }}
              className={cn(
                "cursor-default rounded-lg px-3 py-2 text-sm",
                position === index && "bg-accent text-accent-foreground",
              )}
            >
              {props.renderItem(item)}
            </div>
          ))}
        </div>
        {props.query.trim() && !props.loading && !props.items.length ? (
          <p
            role="status"
            className="px-4 py-6 text-center text-sm text-muted-foreground"
          >
            {t("inbox.noResults")}
          </p>
        ) : null}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
