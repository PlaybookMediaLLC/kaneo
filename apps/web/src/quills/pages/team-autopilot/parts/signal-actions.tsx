import { FilePlus, ThumbsUp, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import type { Signal } from "./signal-detail";

export interface SignalActionsProps {
  signal: Signal;
  /** Hide the controls. The teammate API still decides. */
  canAccept: boolean;
  canReview: boolean;
  /** True while a decision runs. */
  busy: boolean;
  onAcceptAsPost: () => void;
  onVote: () => void;
  onDismiss: () => void;
  onRestore: () => void;
}

/** The decisions of the open signal in the floating action bar: accept, vote, dismiss or restore. */
export function SignalActions({ signal, busy, ...props }: SignalActionsProps) {
  const { t } = useTranslation("quills");
  const pending = signal.status === "pending";
  const actions = [
    {
      id: "post",
      show: pending && props.canAccept,
      label: t("autopilot.acceptPost"),
      shortcut: "a",
      icon: FilePlus,
      onSelect: props.onAcceptAsPost,
    },
    {
      id: "vote",
      show: pending && props.canAccept && Boolean(signal.matchedPost),
      label: t("autopilot.vote"),
      shortcut: "v",
      icon: ThumbsUp,
      onSelect: props.onVote,
    },
    {
      id: "dismiss",
      show: pending && props.canReview,
      label: t("autopilot.dismiss"),
      shortcut: "d",
      icon: X,
      onSelect: props.onDismiss,
    },
    {
      id: "restore",
      show: signal.status === "dismissed" && props.canReview,
      label: t("autopilot.restore"),
      shortcut: "u",
      icon: Undo2,
      onSelect: props.onRestore,
    },
  ]
    .filter((action) => action.show)
    .map((action) => ({ ...action, disabled: busy }));
  return actions.length ? (
    <FloatingActionBar label={t("autopilot.actions")} actions={actions} />
  ) : null;
}
