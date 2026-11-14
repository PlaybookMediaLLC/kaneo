import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Spinner,
} from "../upstream";

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
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup aria-label={props.label}>
        {/* The caller filters the items, so the mode "none" keeps them as they are. */}
        <Command
          items={props.items}
          mode="none"
          value={props.query}
          onValueChange={(query) => props.onQueryChange(query)}
        >
          <div className="flex items-center gap-2 border-b border-border ps-3 pe-4">
            {props.chip ? (
              <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                {props.chip}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <CommandInput
                aria-label={props.placeholder}
                placeholder={props.placeholder}
              />
            </div>
            {props.loading ? <Spinner className="size-4" /> : null}
          </div>
          <CommandEmpty>
            {props.query.trim() && !props.loading ? t("inbox.noResults") : null}
          </CommandEmpty>
          <CommandList>
            {(item: Item) => (
              <CommandItem
                key={props.getKey(item)}
                value={item}
                onClick={() => props.onSelect(item)}
              >
                <div className="min-w-0 flex-1">{props.renderItem(item)}</div>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
