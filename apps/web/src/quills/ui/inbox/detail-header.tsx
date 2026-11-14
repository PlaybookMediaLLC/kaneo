import { ChevronDown, ChevronLeft, ChevronUp, PanelRight } from "lucide-react";
import { type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../upstream";
import { DetailPaneContext } from "./detail-pane-context";

export interface DetailHeaderProps {
  /** The left side, such as the customer's avatar and name. */
  children?: ReactNode;
  /** The right side: the assignee pill, the status button, menus. */
  actions?: ReactNode;
  /** Shows the back button first. Esc does the same through useListNavigation. */
  onBack?: () => void;
  /** The visible text of the back button, such as the board name. */
  backLabel?: string;
  /** The previous and next arrows (K and J), when both are given. */
  onPrevious?: () => void;
  onNext?: () => void;
}

/** The top row of an open item. Inside a DetailLayout it also toggles the right panel. */
export function DetailHeader({
  children,
  actions,
  onBack,
  backLabel,
  onPrevious,
  onNext,
}: DetailHeaderProps) {
  const { t } = useTranslation("quills");
  const panel = useContext(DetailPaneContext)?.panel;
  const steps = [
    { key: "K", label: t("inbox.previous"), icon: ChevronUp, run: onPrevious },
    { key: "J", label: t("inbox.next"), icon: ChevronDown, run: onNext },
  ];
  return (
    <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      {onBack ? (
        <Button
          variant="ghost"
          size={backLabel ? "sm" : "icon-sm"}
          aria-label={
            backLabel ? t("inbox.backTo", { name: backLabel }) : t("inbox.back")
          }
          aria-keyshortcuts="Escape"
          onClick={onBack}
        >
          <ChevronLeft aria-hidden="true" />
          {backLabel}
        </Button>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions}
        {onPrevious && onNext
          ? steps.map(({ key, label, icon: Icon, run }) => (
              <Button
                key={key}
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-keyshortcuts={key}
                onClick={run}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))
          : null}
        {panel ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={panel.label}
            aria-expanded={panel.open}
            onClick={panel.toggle}
          >
            <PanelRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
