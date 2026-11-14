import { useTranslation } from "react-i18next";
import type { ListFeedbackSignalsResponse } from "../../../api/team/list-feedback-signals";

export type Signal = ListFeedbackSignalsResponse["items"][number];

export interface SignalDetailProps {
  signal: Signal;
}

const muted = "text-sm text-muted-foreground";

/** The open signal: its title, the customer, the customer's words and the matching post. */
export function SignalDetail({ signal }: SignalDetailProps) {
  const { t } = useTranslation("quills");
  const { matchedPost, resultingPost } = signal;
  return (
    <article className="grid gap-4 px-6 py-5">
      <header className="grid gap-1">
        <h1 tabIndex={-1} className="text-lg font-semibold outline-none">
          {signal.suggestedTitle}
        </h1>
        <p className={muted}>
          {signal.customer.displayName
            ? t("autopilot.from", { name: signal.customer.displayName })
            : t("autopilot.anonymous")}
        </p>
      </header>
      <blockquote className="border-s-2 border-border ps-3">
        {signal.excerpt}
      </blockquote>
      {matchedPost ? (
        <p className={muted}>
          {t("autopilot.match", {
            title: matchedPost.title,
            board: matchedPost.boardName,
            count: matchedPost.voteCount,
          })}
        </p>
      ) : null}
      {resultingPost ? (
        <p className={muted}>
          {t("autopilot.result", { title: resultingPost.title })}
        </p>
      ) : null}
    </article>
  );
}
