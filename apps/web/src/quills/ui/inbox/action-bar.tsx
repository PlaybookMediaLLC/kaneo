import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Kbd } from "../upstream";
import { useKeyShortcuts } from "./use-key-shortcuts";

export interface ActionBarProps {
  /** The accessible name of the bar, such as "Conversation actions". */
  label: string;
  actions: readonly InboxAction[];
  /** More controls at the end, such as a "More" menu. */
  children?: ReactNode;
}

/** The floating bar at the bottom of an open item: Reply (R), Add note (N) and more. */
export function ActionBar({ label, actions, children }: ActionBarProps) {
  useKeyShortcuts(
    Object.fromEntries(
      actions
        .filter((action) => action.shortcut && !action.disabled)
        .map((action) => [action.shortcut!, action.onSelect]),
    ),
  );
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 flex justify-center px-4">
      <div
        role="group"
        aria-label={label}
        className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-popover p-1 shadow-lg/5"
      >
        {actions.map(({ id, label: text, shortcut, icon: Icon, ...action }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            disabled={action.disabled}
            aria-keyshortcuts={shortcut?.toUpperCase()}
            onClick={action.onSelect}
          >
            {Icon ? <Icon aria-hidden="true" /> : null}
            {text}
            {shortcut ? (
              <Kbd aria-hidden="true" tone="muted">
                {shortcut.toUpperCase()}
              </Kbd>
            ) : null}
          </Button>
        ))}
        {children}
      </div>
    </div>
  );
}

export interface InboxAction {
  id: string;
  label: string;
  /** A single key such as "r". It works only while the action is enabled. */
  shortcut?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}
