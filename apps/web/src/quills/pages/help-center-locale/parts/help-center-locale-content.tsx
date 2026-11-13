import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPublicHelpCenterResponse } from "../../../api/help-center/get-public-help-center";
import type { SearchPublicHelpCenterResponse } from "../../../api/help-center/search-public-help-center";
import { portalHref } from "../../../core/portal-href";
import {
  Button,
  Input,
  Field,
  FieldLabel,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "../../../ui/upstream";

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

  const searchForm = (
    // quills-web-allow C22: Read-only GET search navigation needs native form submission; PortalForm guards data mutations.
    <form
      role="search"
      action={portalHref(props.workspaceId, `hc/${props.locale}`)}
      method="get"
      className="flex items-end gap-3"
    >
      <Field className="flex-1">
        <FieldLabel htmlFor="localized-help-search">
          {t("help-center.searchLabel")}
        </FieldLabel>
        <Input
          id="localized-help-search"
          name="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      <Button type="submit">{t("help-center.search")}</Button>
    </form>
  );

  return (
    <div className="portal-help space-y-10 [&>header]:mb-8 [&>header>p]:mt-3 [&>header>p]:text-muted-foreground [&_section>h2]:mb-5 [&_nav]:text-xs [&_nav]:text-muted-foreground">
      <header className="space-y-2">
        <p>{props.home.homepageDescription}</p>
      </header>
      {searchForm}
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
            <ul className="grid gap-2">
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
            className="portal-help-categories space-y-4"
          >
            <h2
              id="localized-help-categories"
              className="text-xl font-semibold"
            >
              {t("help-center.title")}
            </h2>
            {props.home.categories.length ? (
              <ul className="grid gap-4 sm:grid-cols-2">
                {props.home.categories.map((category) => (
                  <li key={category.id}>
                    <a
                      className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
                      href={href(category.path)}
                    >
                      <Card className="h-full transition-colors hover:bg-muted/50">
                        <CardHeader>
                          <CardTitle>{category.name}</CardTitle>
                          {category.description ? (
                            <CardDescription>
                              {category.description}
                            </CardDescription>
                          ) : null}
                        </CardHeader>
                        <CardFooter className="text-sm text-muted-foreground">
                          {t("help-center.articles", {
                            count: category.articleCount,
                          })}
                        </CardFooter>
                      </Card>
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
              <ul className="grid gap-2">
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
