import { useKeyShortcuts } from "./use-key-shortcuts";

export interface ListNavigationOptions {
  /** The item IDs in display order. */
  ids: readonly string[];
  /** The highlighted item of a list, or the open item of the detail view. */
  activeId: string | null;
  /** J, K and the arrow keys: the list moves its highlight, the detail view opens the item. */
  onMove: (id: string) => void;
  /** Enter opens the active item. */
  onOpen?: (id: string) => void;
  /** Esc goes back to the list. */
  onBack?: () => void;
  enabled?: boolean;
}

/**
 * Keyboard navigation of an inbox list (RFC 0004 D3): J or Down for the next item, K or Up for
 * the previous one, Enter to open and Esc to go back. Keys typed in a text field do nothing.
 * The returned functions are for the buttons that every shortcut needs.
 */
export function useListNavigation({
  ids,
  activeId,
  onMove,
  onOpen,
  onBack,
  enabled = true,
}: ListNavigationOptions) {
  const step = (offset: 1 | -1) => () => {
    if (!ids.length) return;
    const index = activeId === null ? -1 : ids.indexOf(activeId);
    const target =
      index === -1
        ? ids[offset === 1 ? 0 : ids.length - 1]
        : ids[Math.min(ids.length - 1, Math.max(0, index + offset))];
    if (target !== undefined && target !== activeId) onMove(target);
  };
  const next = step(1);
  const previous = step(-1);
  useKeyShortcuts(
    {
      j: next,
      arrowdown: next,
      k: previous,
      arrowup: previous,
      enter: onOpen && activeId !== null ? () => onOpen(activeId) : undefined,
      escape: onBack,
    },
    enabled,
  );
  return { next, previous };
}
