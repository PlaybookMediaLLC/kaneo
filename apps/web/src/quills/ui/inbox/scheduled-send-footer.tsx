import { Clock, RotateCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../upstream";

export interface ScheduledSendFooterProps {
  scheduledSendAt: string;
  recalling?: boolean;
  sendingNow?: boolean;
  canManage?: boolean;
  error?: string | null;
  onUndo: () => void;
  onSendNow: () => void;
}

/**
 * Shown inside a scheduled/undo-send reply bubble until the reply is released (#323).
 * Displays a live second countdown within 60s or formatted timestamp further ahead,
 * plus Undo (recalls and restores text to the composer) and Send now actions.
 */
export function ScheduledSendFooter({
  scheduledSendAt,
  recalling,
  sendingNow,
  canManage = true,
  error,
  onUndo,
  onSendNow,
}: ScheduledSendFooterProps) {
  const { t, i18n } = useTranslation("quills");
  const targetMs = new Date(scheduledSendAt).getTime();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const remainingSeconds = Number.isNaN(targetMs)
    ? 0
    : Math.max(0, Math.ceil((targetMs - nowMs) / 1000));

  useEffect(() => {
    if (Number.isNaN(targetMs)) return;
    if (targetMs - Date.now() <= 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= targetMs) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  const statusText =
    remainingSeconds === 0
      ? t("inbox.scheduled.sending")
      : remainingSeconds <= 60
        ? t("inbox.scheduled.sendingIn", { seconds: remainingSeconds })
        : t("inbox.scheduled.scheduledFor", {
            time: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(scheduledSendAt)),
          });

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-primary-foreground/20 pt-1.5 text-xs">
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <span className="inline-flex items-center gap-1 opacity-90">
          <Clock aria-hidden="true" className="size-3" />
          {statusText}
        </span>
        {canManage ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="border border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              disabled={recalling || sendingNow}
              onClick={onUndo}
            >
              <RotateCcw aria-hidden="true" className="size-3" />
              {t("inbox.scheduled.undo")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              disabled={recalling || sendingNow}
              onClick={onSendNow}
            >
              <Send aria-hidden="true" className="size-3" />
              {t("inbox.scheduled.sendNow")}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
