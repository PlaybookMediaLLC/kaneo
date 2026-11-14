import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPublicHelpCenterCategory } from "../../hooks/help-center/use-get-public-help-center-category";
import { HelpSidebar } from "../../portal/help-sidebar";
import { usePortalRuntime } from "../../portal/runtime";
import { HelpBreadcrumb } from "../../ui/help-breadcrumb";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";

export interface HelpCenterCategoryPageProps {
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

export function HelpCenterCategoryPage(props: HelpCenterCategoryPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const categorySlug = (props.params.idSlug ?? "").replace(/^\d+-/, "");
  const locale = locales.find((item) => item === props.params.locale);
  const category = useGetPublicHelpCenterCategory(
    {
      param: { workspace: props.workspaceId, categorySlug },
      query: { locale },
    },
    viewer,
  );
  const gated = (meta.audience as string) !== "public";
  const data = category.data;
  const href = (path: string) => portalHref(props.workspaceId, path);
  const list = (
    articles: Array<{
      id: string;
      title: string;
      description: string | null;
      path: string;
    }>,
  ) => (
    <ul className="divide-y divide-border">
      {articles.map((article) => (
        <li key={article.id} className="py-4">
          <a
            className="font-medium hover:text-primary"
            href={href(article.path)}
          >
            {article.title}
          </a>
          {article.description ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {article.description}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <PageFrame
      titleKey="help-center.categoryTitle"
      displayTitle={data?.category.name}
      description={data?.category.description ?? undefined}
      eyebrow={
        <HelpBreadcrumb
          items={[
            {
              label: t("help-center.title"),
              href: href(!locale || locale === "en" ? "hc" : `hc/${locale}`),
            },
          ]}
        />
      }
      aside={
        data ? (
          <HelpSidebar
            workspaceId={props.workspaceId}
            locale={locale}
            categories={data.categories}
            categoryId={data.category.id}
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
          currentPath={href(`hc/${locale}/collections/${props.params.idSlug}`)}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={category.isLoading}
            empty={
              data
                ? data.articles.length === 0 && data.subcategories.length === 0
                : false
            }
            problem={category.error ?? null}
            onRetry={() => {
              void category.refetch();
            }}
          >
            {data ? (
              <div className="space-y-10">
                <section aria-labelledby="collection-articles">
                  <h2 id="collection-articles" className="text-sm font-medium">
                    {t("help-center.inCollection")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("help-center.articles", {
                      count: data.category.articleCount,
                    })}
                  </p>
                  {list(data.articles)}
                </section>
                {data.subcategories.map((subcategory) => (
                  <section
                    key={subcategory.id}
                    aria-labelledby={`subcategory-${subcategory.id}`}
                  >
                    <h3
                      id={`subcategory-${subcategory.id}`}
                      className="text-sm font-medium"
                    >
                      {subcategory.name}
                    </h3>
                    {list(subcategory.articles)}
                  </section>
                ))}
              </div>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
