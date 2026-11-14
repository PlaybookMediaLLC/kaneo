import { GitMerge, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import type { Suggestion } from "./suggestion-detail";
import { suggestionStatusKeys } from "./suggestion-properties";

export interface SuggestionActionsProps {
  suggestion: Suggestion;
  /** Hides the actions. The teammate API still decides. */
  canDecide: boolean;
  /** True while a decision runs. */
  busy: boolean;
  onMerge: () => void;
  onDismiss: () => void;
  onRestore: () => void;
}

/**
 * The decisions of the open pair in the floating action bar: the status, then dismiss,
 * and merge or restore as the black main button.
 */
export function SuggestionActions({
  suggestion,
  canDecide,
  busy,
  ...props
}: SuggestionActionsProps) {
  const { t } = useTranslation("quills");
  const pending = suggestion.status === "pending";
  const shown = [
    {
      id: "merge",
      show: pending,
      label: t("duplicates.merge"),
      shortcut: "m",
      icon: GitMerge,
      onSelect: props.onMerge,
    },
    {
      id: "restore",
      show: suggestion.status === "dismissed",
      label: t("duplicates.restore"),
      shortcut: "u",
      icon: Undo2,
      onSelect: props.onRestore,
    },
    {
      id: "dismiss",
      show: pending,
      label: t("duplicates.dismiss"),
      shortcut: "d",
      icon: X,
      onSelect: props.onDismiss,
    },
  ]
    .filter((action) => canDecide && action.show)
    .map((action) => ({ ...action, disabled: busy }));
  const [primary, ...actions] = shown;
  return primary ? (
    <FloatingActionBar
      label={t("duplicates.actions")}
      status={
        <span className="px-3 text-sm font-medium">
          {t(suggestionStatusKeys[suggestion.status])}
        </span>
      }
      actions={actions}
      primary={primary}
    />
  ) : null;
}
