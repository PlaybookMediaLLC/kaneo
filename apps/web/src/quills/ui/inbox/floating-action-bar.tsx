import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Kbd } from "../upstream";
import { IconButton } from "./icon-button";
import type { InboxAction } from "./inbox-types";
import { useKeyShortcuts } from "./use-key-shortcuts";

export interface FloatingActionBarProps {
  /** The accessible name of the bar, such as "Request actions". */
  label: string;
  /** The current status control at the start, such as a status picker. */
  status?: ReactNode;
  /** The pill buttons, such as Merge and Close, or Reply (R) and Note (N). */
  actions?: readonly InboxAction[];
  /** More controls before the main button, such as a menu. */
  children?: ReactNode;
  /** The black main button, such as "Accept". */
  primary?: InboxAction;
  /** The up and down arrows (K and J) in a small pill beside the bar, when both are given. */
  onPrevious?: () => void;
  onNext?: () => void;
}

const pill =
  "pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-popover p-1 shadow-lg/10";

/** The pill bar at the bottom center of a view: status, actions and a black main button. */
export function FloatingActionBar({
  label,
  status,
  actions = [],
  children,
  primary,
  onPrevious,
  onNext,
}: FloatingActionBarProps) {
  const { t } = useTranslation("quills");
  useKeyShortcuts(
    Object.fromEntries(
      [...actions, ...(primary ? [primary] : [])]
        .filter((action) => action.shortcut && !action.disabled)
        .map((action) => [action.shortcut!, action.onSelect]),
    ),
  );
  const button = (action: InboxAction, main = false) => {
    const Icon = action.icon;
    return (
      <Button
        key={action.id}
        variant={main ? "default" : "ghost"}
        size="sm"
        className="rounded-full"
        disabled={action.disabled}
        aria-keyshortcuts={action.shortcut?.toUpperCase()}
        onClick={action.onSelect}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        {action.label}
        {action.shortcut ? (
          <Kbd aria-hidden="true" tone={main ? "tooltip" : "muted"}>
            {action.shortcut.toUpperCase()}
          </Kbd>
        ) : null}
      </Button>
    );
  };
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 mt-auto flex flex-wrap justify-center gap-2 px-4">
      <div role="group" aria-label={label} className={pill}>
        {status}
        {actions.map((action) => button(action))}
        {children}
        {primary ? button(primary, true) : null}
      </div>
      {onPrevious && onNext ? (
        <div className={pill}>
          <IconButton
            className="rounded-full"
            label={t("inbox.previous")}
            aria-keyshortcuts="K"
            onClick={onPrevious}
          >
            <ChevronUp aria-hidden="true" />
          </IconButton>
          <IconButton
            className="rounded-full"
            label={t("inbox.next")}
            aria-keyshortcuts="J"
            onClick={onNext}
          >
            <ChevronDown aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
