import { useTranslation } from "react-i18next";
import type { Viewer } from "../../../core/types";
import { useRecordPublicArticleFeedback } from "../../../hooks/help-center/use-record-public-article-feedback";
import { ConfirmAction } from "../../../ui/confirm-action";
import { StateView } from "../../../ui/state-view";

export interface ArticleFeedbackProps {
  workspaceId: string;
  articleId: string;
  viewer: Viewer;
}

const choice =
  "h-7 rounded-full border-transparent bg-transparent px-3 text-xs text-foreground shadow-none hover:bg-muted sm:h-7 sm:text-xs";

/** "Did this answer your question?" with a yes or no vote. */
export function ArticleFeedback(props: ArticleFeedbackProps) {
  const { t } = useTranslation("quills");
  const record = useRecordPublicArticleFeedback(props.viewer);
  const send = (helpful: boolean) =>
    record
      .mutateAsync({
        param: { workspace: props.workspaceId, articleId: props.articleId },
        json: { helpful },
      })
      .then(() => undefined);
  return (
    <section
      aria-labelledby="article-feedback"
      className="portal-article-feedback mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6"
    >
      <h2
        id="article-feedback"
        className="text-sm font-normal text-muted-foreground"
      >
        {t("help-center.helpful")}
      </h2>
      {record.isSuccess ? (
        <p role="status" className="text-sm">
          {t("help-center.thanks")}
        </p>
      ) : (
        <StateView
          problem={record.error ?? null}
          onRetry={() => record.reset()}
        >
          <div className="flex gap-1 rounded-full border border-border p-1">
            <ConfirmAction
              labelKey="help-center.helpfulYes"
              className={choice}
              onConfirm={() => send(true)}
            />
            <ConfirmAction
              labelKey="help-center.helpfulNo"
              className={choice}
              onConfirm={() => send(false)}
            />
          </div>
        </StateView>
      )}
    </section>
  );
}
