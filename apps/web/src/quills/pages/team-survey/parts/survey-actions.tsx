import { Play, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetSurveyResultsResponse } from "../../../api/team/get-survey-results";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import { SURVEY_STATUS_KEYS } from "../../../ui/survey-labels";

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

/**
 * The status of a survey in the floating action bar, the deletion of a draft, and the next
 * status as the black main button.
 */
export function SurveyActions({ status, busy, ...props }: SurveyActionsProps) {
  const { t } = useTranslation("quills");
  // The delete action has no key: one key press must not delete a draft.
  const shown = [
    {
      id: "delete",
      show: status === "draft" && props.canDelete,
      label: t("surveys.actions.delete"),
      icon: Trash2,
      onSelect: props.onDelete,
    },
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
  ]
    .filter((action) => action.show)
    .map((action) => ({ ...action, disabled: busy }));
  const primary = shown.find((action) => action.id !== "delete");
  return shown.length ? (
    <FloatingActionBar
      label={t("surveys.actions.label")}
      status={
        <span className="px-3 text-sm font-medium">
          {t(SURVEY_STATUS_KEYS[status])}
        </span>
      }
      actions={shown.filter((action) => action !== primary)}
      primary={primary}
    />
  ) : null;
}
