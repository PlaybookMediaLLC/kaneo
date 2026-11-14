import { Play, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetSurveyResultsResponse } from "../../../api/team/get-survey-results";
import { ActionBar } from "../../../ui/inbox/action-bar";

export interface SurveyActionsProps {
  status: GetSurveyResultsResponse["survey"]["status"];
  /** Hide the controls. The teammate API still decides. */
  canUpdate: boolean;
  canDelete: boolean;
  /** True while an action runs. */
  busy: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDelete: () => void;
}

/** The next status of a survey, or the deletion of a draft, in the floating action bar. */
export function SurveyActions({ status, busy, ...props }: SurveyActionsProps) {
  const { t } = useTranslation("quills");
  // The delete action has no key: one key press must not delete a draft.
  const actions = [
    {
      id: "activate",
      show: status === "draft" && props.canUpdate,
      label: t("surveys.actions.activate"),
      shortcut: "a",
      icon: Play,
      onSelect: props.onActivate,
    },
    {
      id: "close",
      show: status === "active" && props.canUpdate,
      label: t("surveys.actions.close"),
      shortcut: "c",
      icon: Square,
      onSelect: props.onClose,
    },
    {
      id: "delete",
      show: status === "draft" && props.canDelete,
      label: t("surveys.actions.delete"),
      icon: Trash2,
      onSelect: props.onDelete,
    },
  ]
    .filter((action) => action.show)
    .map((action) => ({ ...action, disabled: busy }));
  return actions.length ? (
    <ActionBar label={t("surveys.actions.label")} actions={actions} />
  ) : null;
}
