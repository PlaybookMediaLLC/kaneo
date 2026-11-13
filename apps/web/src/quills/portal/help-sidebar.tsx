import { useTranslation } from "react-i18next";
import type { ListPublicHelpCenterCategoryArticlesRequest } from "../api/help-center/list-public-help-center-category-articles";
import { portalHref } from "../core/portal-href";
import { useListPublicHelpCenterCategoryArticles } from "../hooks/help-center/use-list-public-help-center-category-articles";
import { usePortalRuntime } from "./runtime";

type Locale = ListPublicHelpCenterCategoryArticlesRequest["query"]["locale"];

export interface HelpSidebarProps {
  workspaceId: string;
  locale?: Locale;
  categories: Array<{
    id: string;
    name: string;
    path: string;
    parentId: string | null;
  }>;
  categoryId?: string;
  articleId?: string;
}

const link =
  "block rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground";

/**
 * Every top-level help category with its articles, as on the help-center front page.
 * ponytail: one articles request per category; add article titles to the help-center
 * response if help centers grow past a dozen categories.
 */
export function HelpSidebar(props: HelpSidebarProps) {
  const { t } = useTranslation("quills");
  return (
    <nav
      aria-label={t("help-center.collections")}
      className="portal-help-sidebar hidden flex-col gap-7 md:sticky md:top-8 md:flex"
    >
      {props.categories
        .filter((category) => !category.parentId)
        .map((category) => (
          <HelpSidebarSection
            key={category.id}
            workspaceId={props.workspaceId}
            locale={props.locale}
            category={category}
            current={category.id === props.categoryId && !props.articleId}
            articleId={props.articleId}
          />
        ))}
    </nav>
  );
}

function HelpSidebarSection(props: {
  workspaceId: string;
  locale?: Locale;
  category: { id: string; name: string; path: string };
  current: boolean;
  articleId?: string;
}) {
  const { viewer } = usePortalRuntime();
  const articles = useListPublicHelpCenterCategoryArticles(
    {
      param: { workspace: props.workspaceId, categoryId: props.category.id },
      query: { locale: props.locale },
    },
    viewer,
  );
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider">
        <a
          href={portalHref(props.workspaceId, props.category.path)}
          aria-current={props.current ? "page" : undefined}
        >
          {props.category.name}
        </a>
      </h2>
      <ul>
        {articles.data?.articles.map((article) => (
          <li key={article.id}>
            <a
              className={link}
              href={portalHref(props.workspaceId, article.path)}
              aria-current={article.id === props.articleId ? "page" : undefined}
            >
              {article.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
