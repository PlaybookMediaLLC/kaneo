import { HelpNavigation } from "../../ui/help-navigation";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPublicHelpCenterArticle } from "../../hooks/help-center/use-get-public-help-center-article";
import { usePortalRuntime } from "../../portal/runtime";
import { MarkdownContent } from "../../ui/markdown-content";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";

export interface HelpCenterArticlePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function HelpCenterArticlePage(props: HelpCenterArticlePageProps) {
  const { t, i18n } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const locale = (
    [
      "en",
      "de",
      "fr",
      "es",
      "ar",
      "ru",
      "pt-br",
      "zh-cn",
      "zh-tw",
      "nl",
      "pl",
      "th",
      "uk",
    ] as const
  ).find((item) => item === props.params.locale);
  const article = useGetPublicHelpCenterArticle(
    {
      param: {
        workspace: props.workspaceId,
        idSlug: props.params.idSlug ?? "",
      },
      query: { locale },
    },
    viewer,
  );
  const gated = (meta.audience as string) !== "public";

  return (
    <PageFrame
      titleKey="help-center.articleTitle"
      displayTitle={article.data?.article.title}
    >
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(
            props.workspaceId,
            `hc/${locale}/articles/${props.params.idSlug}`,
          )}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={article.isLoading}
            problem={article.error ?? null}
            onRetry={() => {
              void article.refetch();
            }}
          >
            {article.data ? (
              <div className="grid items-start gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
                <HelpNavigation
                  workspaceId={props.workspaceId}
                  categories={article.data.categories}
                  locale={props.params.locale ?? "en"}
                  categoryId={article.data.article.category.id}
                  articleId={article.data.article.id}
                  articles={article.data.articles}
                />
                <div className="min-w-0">
                  <article className="space-y-8">
                    <header className="space-y-2">
                      {article.data.article.description ? (
                        <p>{article.data.article.description}</p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        {t("help-center.published", {
                          date: new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: "long",
                          }).format(new Date(article.data.article.publishedAt)),
                        })}
                      </p>
                    </header>
                    <MarkdownContent content={article.data.article.content} />
                    {article.data.articles.filter(
                      (item) => item.id !== article.data.article.id,
                    ).length ? (
                      <section
                        aria-labelledby="related-articles"
                        className="space-y-3"
                      >
                        <h3
                          id="related-articles"
                          className="text-lg font-semibold"
                        >
                          {t("help-center.related")}
                        </h3>
                        <ul>
                          {article.data.articles
                            .filter(
                              (item) => item.id !== article.data.article.id,
                            )
                            .map((item) => (
                              <li key={item.id}>
                                <a
                                  className="underline-offset-4 hover:underline"
                                  href={portalHref(
                                    props.workspaceId,
                                    item.path,
                                  )}
                                >
                                  {item.title}
                                </a>
                              </li>
                            ))}
                        </ul>
                      </section>
                    ) : null}
                    <a
                      className="underline-offset-4 hover:underline"
                      href={portalHref(
                        props.workspaceId,
                        props.params.locale === "en"
                          ? "hc"
                          : `hc/${props.params.locale}`,
                      )}
                    >
                      {t("help-center.back")}
                    </a>
                  </article>
                </div>
              </div>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
