import { Lock, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InternalContentCheck } from "../../core/reply-safety";
import type { ThreadViewer } from "../../hooks/team/use-thread-presence";
import { Button } from "../upstream";

export interface ReplyGuardrailBannerProps {
  /** Non-null when an @mention or internal-only phrase was detected in reply mode. */
  internalWarning: InternalContentCheck | null;
  /** True when the user tried to send while flagged and must confirm or switch. */
  confirmingSend: boolean;
  /** True while an upload or send mutation is currently in flight. */
  sending?: boolean;
  /** Other teammates actively replying to the same thread. */
  replyingTeammates: readonly ThreadViewer[];
  /** Whether the user is allowed to switch to internal note mode. */
  canSwitchToNote: boolean;
  onSwitchToNote: () => void;
  onConfirmSendAnyway?: () => void;
}

/**
 * Guardrail banners inside the reply composer (#324):
 * 1) Prompts "Did you mean an internal note?" when @mention or internal cues appear in reply mode.
 * 2) Offers "Leave a note instead" when another teammate is already replying.
 */
export function ReplyGuardrailBanner({
  internalWarning,
  confirmingSend,
  sending,
  replyingTeammates,
  canSwitchToNote,
  onSwitchToNote,
  onConfirmSendAnyway,
}: ReplyGuardrailBannerProps) {
  const { t } = useTranslation("quills");
  const firstReplier = replyingTeammates[0];
  const showInternal = Boolean(internalWarning?.flagged);
  const showCollision = Boolean(firstReplier);

  if (!showInternal && !showCollision) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {showInternal && internalWarning ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/60 bg-warning/15 px-2.5 py-2 text-xs text-warning-foreground"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {internalWarning.reason === "mention"
              ? t("inbox.guardrail.mentionPrompt", {
                  mention: internalWarning.matchedMentions[0] ?? "@",
                })
              : t("inbox.guardrail.internalPrompt")}
          </span>
          <div className="flex items-center gap-1.5">
            {canSwitchToNote ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="border-warning/70 bg-background text-warning-foreground"
                onClick={onSwitchToNote}
              >
                <Lock aria-hidden="true" className="size-3" />
                {t("inbox.guardrail.switchToNote")}
              </Button>
            ) : null}
            {confirmingSend && onConfirmSendAnyway ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={sending}
                onClick={onConfirmSendAnyway}
              >
                {t("inbox.guardrail.sendAnyway")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {showCollision && firstReplier ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs text-foreground"
        >
          <span>
            {t("inbox.guardrail.teammateReplying", {
              name: firstReplier.displayName ?? t("inbox.teammate"),
            })}
          </span>
          {canSwitchToNote ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onSwitchToNote}
            >
              <Lock aria-hidden="true" className="size-3" />
              {t("inbox.guardrail.leaveNoteInstead")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
