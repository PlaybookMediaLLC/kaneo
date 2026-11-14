import { GitMerge, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import type { Suggestion } from "./suggestion-detail";

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

/** The decisions of the open pair in the floating action bar: merge, dismiss or restore. */
export function SuggestionActions({
  suggestion,
  canDecide,
  busy,
  ...props
}: SuggestionActionsProps) {
  const { t } = useTranslation("quills");
  const pending = suggestion.status === "pending";
  const actions = [
    {
      id: "merge",
      show: pending,
      label: t("duplicates.merge"),
      shortcut: "m",
      icon: GitMerge,
      onSelect: props.onMerge,
    },
    {
      id: "dismiss",
      show: pending,
      label: t("duplicates.dismiss"),
      shortcut: "d",
      icon: X,
      onSelect: props.onDismiss,
    },
    {
      id: "restore",
      show: suggestion.status === "dismissed",
      label: t("duplicates.restore"),
      shortcut: "u",
      icon: Undo2,
      onSelect: props.onRestore,
    },
  ]
    .filter((action) => canDecide && action.show)
    .map((action) => ({ ...action, disabled: busy }));
  return actions.length ? (
    <FloatingActionBar label={t("duplicates.actions")} actions={actions} />
  ) : null;
}
