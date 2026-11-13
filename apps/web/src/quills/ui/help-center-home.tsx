import {
  IconBookOpenOutline18,
  IconMagnifierOutline18,
} from "nucleo-ui-essential-outline-18";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import { Input } from "./upstream";

interface ArticleLink {
  id: string;
  title: string;
  path: string;
}

export interface HelpCenterHomeProps {
  workspaceId: string;
  /** The help-center locale; the default locale has no path segment. */
  locale?: string;
  locales: string[];
  categories: Array<{
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    articleCount: number;
    path: string;
    parentId: string | null;
  }>;
  popular: ArticleLink[];
  results?: Array<ArticleLink & { snippet: string }>;
  searchQuery: string;
}

const home = (locale?: string) =>
  !locale || locale === "en" ? "hc" : `hc/${locale}`;

/** The help-center front page: search, then a card per top-level category. */
export function HelpCenterHome(props: HelpCenterHomeProps) {
  const { t } = useTranslation("quills");
  const [query, setQuery] = useState(props.searchQuery);
  useEffect(() => setQuery(props.searchQuery), [props.searchQuery]);
  const href = (path: string) => portalHref(props.workspaceId, path);
  const links = (articles: Array<ArticleLink & { snippet?: string }>) => (
    <ul className="divide-y divide-border">
      {articles.map((article) => (
        <li key={article.id} className="py-3">
          <a
            className="font-medium hover:text-primary"
            href={href(article.path)}
          >
            {article.title}
          </a>
          {article.snippet ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {article.snippet}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const searchForm = (
    // quills-web-allow C22: Read-only GET search navigation needs native form submission; PortalForm guards data mutations.
    <form
      role="search"
      className="relative"
      action={href(home(props.locale))}
      method="get"
    >
      <IconMagnifierOutline18
        aria-hidden="true"
        className="pointer-events-none absolute start-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        name="query"
        size="lg"
        className="rounded-xl ps-7"
        aria-label={t("help-center.searchLabel")}
        placeholder={t("help-center.searchLabel")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </form>
  );

  return (
    <div className="portal-help space-y-10 [&_h2]:mb-4 [&_h2]:text-xs [&_h2]:font-normal [&_h2]:text-muted-foreground">
      {searchForm}
      {props.searchQuery ? (
        <section aria-labelledby="help-results">
          <h2 id="help-results">{t("help-center.searchResults")}</h2>
          {props.results?.length ? (
            links(props.results)
          ) : (
            <p className="text-muted-foreground">
              {t("help-center.noResults")}
            </p>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="help-categories">
            <h2 id="help-categories" className="sr-only">
              {t("help-center.collections")}
            </h2>
            {props.categories.length ? (
              <ul className="grid gap-x-4 gap-y-8 sm:grid-cols-2">
                {props.categories
                  .filter((category) => !category.parentId)
                  .map((category) => (
                    <li key={category.id}>
                      <a className="group block" href={href(category.path)}>
                        <span className="relative grid aspect-[2/1] place-items-center overflow-hidden rounded-2xl bg-muted/70 transition-colors group-hover:bg-muted">
                          <span
                            aria-hidden="true"
                            className="absolute size-36 rounded-full border border-border/70"
                          />
                          <span
                            aria-hidden="true"
                            className="absolute size-56 rounded-full border border-border/50"
                          />
                          <span
                            aria-hidden="true"
                            className="absolute size-80 rounded-full border border-border/30"
                          />
                          <span className="relative grid size-16 place-items-center rounded-full bg-background text-2xl text-primary shadow-sm">
                            {category.icon || (
                              <IconBookOpenOutline18
                                aria-hidden="true"
                                className="size-7"
                              />
                            )}
                          </span>
                        </span>
                        <span className="mt-3 block font-medium">
                          {category.name}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {category.description ||
                            t("help-center.articles", {
                              count: category.articleCount,
                            })}
                        </span>
                      </a>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t("help-center.empty")}</p>
            )}
          </section>
          {props.popular.length ? (
            <section aria-labelledby="help-popular">
              <h2 id="help-popular">{t("help-center.popular")}</h2>
              {links(props.popular)}
            </section>
          ) : null}
        </>
      )}
      {props.locales.length > 1 ? (
        <nav aria-label={t("help-center.languages")}>
          <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {props.locales.map((item) => (
              <li key={item}>
                <a
                  className="hover:text-foreground aria-[current]:text-foreground"
                  lang={item}
                  aria-current={
                    item === (props.locale ?? "en") ? "true" : undefined
                  }
                  href={portalHref(props.workspaceId, home(item), {
                    query: props.searchQuery || undefined,
                  })}
                >
                  {item}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
