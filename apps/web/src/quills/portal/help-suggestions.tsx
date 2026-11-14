import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import { useSearchPublicHelpCenter } from "../hooks/help-center/use-search-public-help-center";
import { usePortalRuntime } from "./runtime";

export interface HelpSuggestionsProps {
  workspaceId: string;
  /** The title in the composer, after its typing pause. */
  title: string;
}

/** Up to three help-center articles that match the title the writer is typing. */
export function HelpSuggestions({ workspaceId, title }: HelpSuggestionsProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const headingId = useId();
  // A workspace without a help center answers 404: show nothing and stop asking.
  const [noHelpCenter, setNoHelpCenter] = useState(false);
  const query = title.trim();
  const search = useSearchPublicHelpCenter(
    {
      param: {
        workspace: !noHelpCenter && query.length >= 3 ? workspaceId : "",
      },
      json: { query, limit: 3 },
    },
    portal.viewer,
  );
  useEffect(() => {
    if (search.error?.kind === "notFound") setNoHelpCenter(true);
  }, [search.error]);
  const articles = search.data?.articles ?? [];
  if (!articles.length) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-1 text-xs font-normal text-muted-foreground"
      >
        {t("assist.articles")}
      </h2>
      <ul className="-mx-3">
        {articles.map((article) => (
          <li key={article.id}>
            <a
              className="flex items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
              href={portalHref(workspaceId, article.path)}
            >
              <span className="min-w-0 flex-1 truncate font-medium tracking-tight">
                {article.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {article.category.name}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
