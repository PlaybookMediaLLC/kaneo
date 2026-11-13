import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPublicHelpCenterArticle } from "../../hooks/help-center/use-get-public-help-center-article";
import { HelpSidebar } from "../../portal/help-sidebar";
import { usePortalRuntime } from "../../portal/runtime";
import { HelpBreadcrumb } from "../../ui/help-breadcrumb";
import { MarkdownContent } from "../../ui/markdown-content";
import { PageFrame } from "../../ui/page-frame";
import { PersonAvatar } from "../../ui/person-avatar";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { ArticleFeedback } from "./parts/article-feedback";
import { ArticleNextSteps } from "./parts/article-next-steps";

export interface HelpCenterArticlePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const locales = [
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
] as const;

export function HelpCenterArticlePage(props: HelpCenterArticlePageProps) {
  const { t, i18n } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const locale = locales.find((item) => item === props.params.locale);
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
  const data = article.data;
  const category = data?.categories.find(
    (item) => item.id === data.article.category.id,
  );
  const home = portalHref(
    props.workspaceId,
    !locale || locale === "en" ? "hc" : `hc/${locale}`,
  );

  return (
    <PageFrame
      titleKey="help-center.articleTitle"
      displayTitle={data?.article.title}
      eyebrow={
        data ? (
          <HelpBreadcrumb
            items={[
              { label: t("help-center.title"), href: home },
              ...(category
                ? [
                    {
                      label: category.name,
                      href: portalHref(props.workspaceId, category.path),
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
      aside={
        data ? (
          <HelpSidebar
            workspaceId={props.workspaceId}
            locale={locale}
            categories={data.categories}
            categoryId={data.article.category.id}
            articleId={data.article.id}
          />
        ) : null
      }
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
            {data ? (
              <article>
                <p className="-mt-4 mb-8 flex items-center gap-2.5 text-sm">
                  {data.article.author ? (
                    <>
                      <PersonAvatar
                        name={data.article.author.name}
                        className="size-7"
                      />
                      <span className="font-medium">
                        {data.article.author.name}
                      </span>
                    </>
                  ) : null}
                  <span className="text-muted-foreground">
                    {t("help-center.updated", {
                      date: new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "medium",
                      }).format(new Date(data.article.updatedAt)),
                    })}
                  </span>
                </p>
                <MarkdownContent content={data.article.content} />
                <ArticleFeedback
                  workspaceId={props.workspaceId}
                  articleId={data.article.id}
                  viewer={viewer}
                />
                <ArticleNextSteps
                  workspaceId={props.workspaceId}
                  articleId={data.article.id}
                  articles={data.articles}
                />
              </article>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
