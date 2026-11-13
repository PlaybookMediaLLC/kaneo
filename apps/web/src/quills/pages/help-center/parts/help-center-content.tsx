import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPublicHelpCenterResponse } from "../../../api/help-center/get-public-help-center";
import type { SearchPublicHelpCenterResponse } from "../../../api/help-center/search-public-help-center";
import { portalHref } from "../../../core/portal-href";
import { Button, Input, Label } from "../../../ui/upstream";

export interface HelpCenterContentProps {
  workspaceId: string;
  home: GetPublicHelpCenterResponse;
  results: SearchPublicHelpCenterResponse | undefined;
  searchQuery: string;
}

export function HelpCenterContent(props: HelpCenterContentProps) {
  const { t } = useTranslation("quills");
  const [query, setQuery] = useState(props.searchQuery);
  useEffect(() => setQuery(props.searchQuery), [props.searchQuery]);
  const href = (path: string) => portalHref(props.workspaceId, path);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">{props.home.homepageTitle}</h2>
        <p>{props.home.homepageDescription}</p>
      </header>
      <div className="space-y-2">
        <Label htmlFor="help-search">{t("help-center.searchLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id="help-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            render={
              <a
                href={portalHref(props.workspaceId, "hc", {
                  query: query.trim() || undefined,
                })}
              />
            }
          >
            {t("help-center.search")}
          </Button>
        </div>
      </div>
      <nav aria-label={t("help-center.languages")}>
        <ul className="flex flex-wrap gap-3">
          {props.home.locales.map((locale) => (
            <li key={locale}>
              <a
                className="underline-offset-4 hover:underline"
                lang={locale}
                href={portalHref(
                  props.workspaceId,
                  locale === "en" ? "hc" : `hc/${locale}`,
                  { query: props.searchQuery || undefined },
                )}
              >
                {locale}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {props.searchQuery ? (
        <section aria-labelledby="help-results" className="space-y-3">
          <h2 id="help-results" className="text-xl font-semibold">
            {t("help-center.searchResults")}
          </h2>
          {props.results?.articles.length ? (
            <ul className="space-y-2">
              {props.results.articles.map((article) => (
                <li key={article.id}>
                  <a
                    className="underline-offset-4 hover:underline"
                    href={href(article.path)}
                  >
                    {article.title}
                  </a>
                  <p>{article.snippet}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("help-center.noResults")}</p>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="help-categories" className="space-y-3">
            <h2 id="help-categories" className="text-xl font-semibold">
              {t("help-center.title")}
            </h2>
            {props.home.categories.length ? (
              <ul className="space-y-2">
                {props.home.categories.map((category) => (
                  <li key={category.id}>
                    <a
                      className="underline-offset-4 hover:underline"
                      href={href(category.path)}
                    >
                      {category.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("help-center.empty")}</p>
            )}
          </section>
          {props.home.popular.length ? (
            <section aria-labelledby="help-popular" className="space-y-3">
              <h2 id="help-popular" className="text-xl font-semibold">
                {t("help-center.popular")}
              </h2>
              <ul className="space-y-2">
                {props.home.popular.map((article) => (
                  <li key={article.id}>
                    <a
                      className="underline-offset-4 hover:underline"
                      href={href(article.path)}
                    >
                      {article.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
