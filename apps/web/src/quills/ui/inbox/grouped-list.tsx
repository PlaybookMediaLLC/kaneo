import { type ReactNode, useId } from "react";

export interface GroupedListProps<Item> {
  /** The accessible name of the whole list. */
  label: string;
  groups: readonly ListGroup<Item>[];
  getKey: (item: Item) => string;
  renderItem: (item: Item) => ReactNode;
}

/** Inbox rows in groups, each under a header with its count. Empty groups are left out. */
export function GroupedList<Item>({
  label,
  groups,
  getKey,
  renderItem,
}: GroupedListProps<Item>) {
  const id = useId();
  return (
    <div aria-label={label} role="region" className="min-w-0">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`${id}-${group.id}`}
          >
            <h2
              id={`${id}-${group.id}`}
              className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/80 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur"
            >
              {group.label}{" "}
              <span className="tabular-nums">{group.items.length}</span>
            </h2>
            <ul className="divide-y divide-border">
              {group.items.map((item) => (
                <li key={getKey(item)}>{renderItem(item)}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

export interface ListGroup<Item> {
  id: string;
  /** The group header, such as a priority or a status. */
  label: string;
  items: readonly Item[];
}
