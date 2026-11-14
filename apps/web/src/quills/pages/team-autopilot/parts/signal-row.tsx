import { useTranslation } from "react-i18next";
import type { ListFeedbackSignalsResponse } from "../../../api/team/list-feedback-signals";
import { ConfirmAction } from "../../../ui/confirm-action";
import { Button } from "../../../ui/upstream";

export type Signal = ListFeedbackSignalsResponse["items"][number];

export interface SignalRowProps {
  signal: Signal;
  /** Hide the controls. The teammate API still decides. */
  canAccept: boolean;
  canReview: boolean;
  onAcceptAsPost: () => void;
  onVote: () => Promise<void>;
  onDismiss: () => Promise<void>;
  onRestore: () => Promise<void>;
}

const muted = "text-sm text-muted-foreground";

/** One signal: the customer's words, where they came from, the match and the decisions. */
export function SignalRow({ signal, ...props }: SignalRowProps) {
  const { t } = useTranslation("quills");
  const { source, matchedPost, resultingPost } = signal;
  const title = { title: signal.suggestedTitle };
  const place =
    source.type === "conversation"
      ? source.title
        ? t("autopilot.conversationTitle", { title: source.title })
        : t("autopilot.conversation")
      : source.title
        ? t("autopilot.ticketTitle", {
            number: source.number,
            title: source.title,
          })
        : t("autopilot.ticket", { number: source.number });
  return (
    <li className="space-y-2 px-4 py-3">
      <p className="font-medium">{signal.suggestedTitle}</p>
      <blockquote className="border-l-2 border-border pl-3 text-sm">
        {signal.excerpt}
      </blockquote>
      <p className={muted}>{place}</p>
      <p className={muted}>
        {signal.customer.displayName
          ? t("autopilot.from", { name: signal.customer.displayName })
          : t("autopilot.anonymous")}
      </p>
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
      {signal.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          {props.canAccept ? (
            <Button
              type="button"
              variant="outline"
              aria-label={t("autopilot.acceptPostFor", title)}
              onClick={props.onAcceptAsPost}
            >
              {t("autopilot.acceptPost")}
            </Button>
          ) : null}
          {props.canAccept && matchedPost ? (
            <ConfirmAction
              labelKey="autopilot.voteFor"
              labelValues={{ post: matchedPost.title }}
              onConfirm={props.onVote}
            >
              {t("autopilot.vote")}
            </ConfirmAction>
          ) : null}
          {props.canReview ? (
            <ConfirmAction
              labelKey="autopilot.dismissFor"
              labelValues={title}
              onConfirm={props.onDismiss}
            >
              {t("autopilot.dismiss")}
            </ConfirmAction>
          ) : null}
        </div>
      ) : signal.status === "dismissed" && props.canReview ? (
        <ConfirmAction
          labelKey="autopilot.restoreFor"
          labelValues={title}
          onConfirm={props.onRestore}
        >
          {t("autopilot.restore")}
        </ConfirmAction>
      ) : null}
    </li>
  );
}
