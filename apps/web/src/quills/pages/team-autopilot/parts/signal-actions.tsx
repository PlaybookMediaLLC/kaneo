import { FilePlus, ThumbsUp, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import type { Signal } from "./signal-detail";
import { signalStatusKeys } from "./signal-properties";

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

/**
 * The decisions of the open signal in the floating action bar: the status, then accept,
 * vote, dismiss or restore. The black main button is the vote for a signal that matches a
 * post, else the new post, or the restore of a dismissed signal.
 */
export function SignalActions({ signal, busy, ...props }: SignalActionsProps) {
  const { t } = useTranslation("quills");
  const pending = signal.status === "pending";
  const shown = [
    {
      id: "vote",
      show: pending && props.canAccept && Boolean(signal.matchedPost),
      label: t("autopilot.vote"),
      shortcut: "v",
      icon: ThumbsUp,
      onSelect: props.onVote,
    },
    {
      id: "post",
      show: pending && props.canAccept,
      label: t("autopilot.acceptPost"),
      shortcut: "a",
      icon: FilePlus,
      onSelect: props.onAcceptAsPost,
    },
    {
      id: "restore",
      show: signal.status === "dismissed" && props.canReview,
      label: t("autopilot.restore"),
      shortcut: "u",
      icon: Undo2,
      onSelect: props.onRestore,
    },
    {
      id: "dismiss",
      show: pending && props.canReview,
      label: t("autopilot.dismiss"),
      shortcut: "d",
      icon: X,
      onSelect: props.onDismiss,
    },
  ]
    .filter((action) => action.show)
    .map((action) => ({ ...action, disabled: busy }));
  const primary = shown.find((action) => action.id !== "dismiss");
  return shown.length ? (
    <FloatingActionBar
      label={t("autopilot.actions")}
      status={
        <span className="px-3 text-sm font-medium">
          {t(signalStatusKeys[signal.status])}
        </span>
      }
      actions={shown.filter((action) => action !== primary)}
      primary={primary}
    />
  ) : null;
}
