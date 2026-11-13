import { useId } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../../core/portal-href";

export interface ArticleNextStepsProps {
  workspaceId: string;
  articleId: string;
  /** The articles of the same collection, in reading order. */
  articles: Array<{ id: string; title: string; path: string }>;
}

const step =
  "flex min-w-0 flex-col gap-0.5 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-muted/50";
const pill = "rounded-full px-3 py-1.5 text-xs font-medium transition-colors";

/** The previous and next articles, and a way to ask the team when the article did not help. */
export function ArticleNextSteps(props: ArticleNextStepsProps) {
  const { t } = useTranslation("quills");
  const headingId = useId();
  const index = props.articles.findIndex(
    (article) => article.id === props.articleId,
  );
  const previous = index > 0 ? props.articles[index - 1] : undefined;
  const next = index >= 0 ? props.articles[index + 1] : undefined;
  return (
    <>
      {previous || next ? (
        <nav
          aria-label={t("help-center.moreArticles")}
          className="mt-10 grid gap-3 sm:grid-cols-2"
        >
          {previous ? (
            <a
              className={step}
              href={portalHref(props.workspaceId, previous.path)}
            >
              <span className="text-xs text-muted-foreground">
                {t("help-center.previous")}
              </span>
              <span className="truncate font-medium">{previous.title}</span>
            </a>
          ) : (
            <span aria-hidden="true" />
          )}
          {next ? (
            <a
              className={`${step} sm:text-right`}
              href={portalHref(props.workspaceId, next.path)}
            >
              <span className="text-xs text-muted-foreground">
                {t("help-center.next")}
              </span>
              <span className="truncate font-medium">{next.title}</span>
            </a>
          ) : null}
        </nav>
      ) : null}
      <section
        aria-labelledby={headingId}
        className="mt-10 rounded-2xl bg-muted/50 p-5"
      >
        <h2 id={headingId} className="text-sm font-medium">
          {t("help-center.stillNeedHelp")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("help-center.stillNeedHelpBody")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            className={`${pill} bg-primary text-primary-foreground hover:bg-primary/90`}
            href={portalHref(props.workspaceId, "", { openFeedback: "1" })}
          >
            {t("help-center.submitFeedback")}
          </a>
          <a
            className={`${pill} bg-background hover:bg-muted`}
            href={portalHref(props.workspaceId, "support")}
          >
            {t("help-center.contactSupport")}
          </a>
        </div>
      </section>
    </>
  );
}
