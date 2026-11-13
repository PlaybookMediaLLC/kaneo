import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPublicHelpCenterCategory } from "../../hooks/help-center/use-get-public-help-center-category";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";

export interface HelpCenterCategoryPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function HelpCenterCategoryPage(props: HelpCenterCategoryPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const categorySlug = (props.params.idSlug ?? "").replace(/^\d+-/, "");
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
  const category = useGetPublicHelpCenterCategory(
    {
      param: { workspace: props.workspaceId, categorySlug },
      query: { locale },
    },
    viewer,
  );
  const gated = (meta.audience as string) !== "public";

  return (
    <PageFrame titleKey="help-center.categoryTitle">
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(
            props.workspaceId,
            `hc/${locale}/collections/${props.params.idSlug}`,
          )}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={category.isLoading}
            empty={
              category.data
                ? category.data.articles.length === 0 &&
                  category.data.subcategories.length === 0
                : false
            }
            problem={category.error ?? null}
            onRetry={() => {
              void category.refetch();
            }}
          >
            {category.data ? (
              <div className="space-y-8">
                <header className="space-y-2">
                  <h2 className="text-xl font-semibold">
                    {category.data.category.name}
                  </h2>
                  {category.data.category.description ? (
                    <p>{category.data.category.description}</p>
                  ) : null}
                </header>
                <ul className="space-y-3">
                  {category.data.articles.map((article) => (
                    <li key={article.id}>
                      <a
                        className="underline-offset-4 hover:underline"
                        href={portalHref(props.workspaceId, article.path)}
                      >
                        {article.title}
                      </a>
                      {article.description ? (
                        <p>{article.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {category.data.subcategories.map((subcategory) => (
                  <section
                    key={subcategory.id}
                    aria-labelledby={`subcategory-${subcategory.id}`}
                    className="space-y-3"
                  >
                    <h3
                      id={`subcategory-${subcategory.id}`}
                      className="text-lg font-semibold"
                    >
                      {subcategory.name}
                    </h3>
                    <ul>
                      {subcategory.articles.map((article) => (
                        <li key={article.id}>
                          <a
                            className="underline-offset-4 hover:underline"
                            href={portalHref(props.workspaceId, article.path)}
                          >
                            {article.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
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
              </div>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
