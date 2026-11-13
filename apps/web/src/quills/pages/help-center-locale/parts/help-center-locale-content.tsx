import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPublicHelpCenterResponse } from "../../../api/help-center/get-public-help-center";
import type { SearchPublicHelpCenterResponse } from "../../../api/help-center/search-public-help-center";
import { portalHref } from "../../../core/portal-href";
import { Button, Input, Label } from "../../../ui/upstream";

export interface HelpCenterLocaleContentProps {
  workspaceId: string;
  locale: string;
  home: GetPublicHelpCenterResponse;
  results: SearchPublicHelpCenterResponse | undefined;
  searchQuery: string;
}

export function HelpCenterLocaleContent(props: HelpCenterLocaleContentProps) {
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
        <Label htmlFor="localized-help-search">
          {t("help-center.searchLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="localized-help-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            render={
              <a
                href={portalHref(props.workspaceId, `hc/${props.locale}`, {
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
          {props.home.locales.map((item) => (
            <li key={item}>
              <a
                className="underline-offset-4 hover:underline"
                lang={item}
                href={portalHref(
                  props.workspaceId,
                  item === "en" ? "hc" : `hc/${item}`,
                  { query: props.searchQuery || undefined },
                )}
              >
                {item}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {props.searchQuery ? (
        <section aria-labelledby="localized-help-results" className="space-y-3">
          <h2 id="localized-help-results" className="text-xl font-semibold">
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
          <section
            aria-labelledby="localized-help-categories"
            className="space-y-3"
          >
            <h2
              id="localized-help-categories"
              className="text-xl font-semibold"
            >
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
            <section
              aria-labelledby="localized-help-popular"
              className="space-y-3"
            >
              <h2 id="localized-help-popular" className="text-xl font-semibold">
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
