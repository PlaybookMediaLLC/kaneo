import { useTranslation } from "react-i18next";
import type { ListMergeSuggestionsResponse } from "../../../api/team/list-merge-suggestions";

export type Suggestion = ListMergeSuggestionsResponse["items"][number];

export interface SuggestionDetailProps {
  suggestion: Suggestion;
}

const muted = "text-sm text-muted-foreground";

/** The open pair: the duplicate, the post to keep, the match and the reason. */
export function SuggestionDetail({ suggestion }: SuggestionDetailProps) {
  const { t } = useTranslation("quills");
  const sides = [
    { labelKey: "duplicates.duplicate", post: suggestion.source },
    { labelKey: "duplicates.keep", post: suggestion.target },
  ];
  return (
    <article className="grid gap-4 px-6 py-5">
      <header className="grid gap-1">
        <h1 tabIndex={-1} className="text-lg font-semibold outline-none">
          {t("duplicates.pair", {
            source: suggestion.source.title,
            target: suggestion.target.title,
          })}
        </h1>
        <p className={muted}>
          {t("duplicates.match", {
            percent: Math.round(suggestion.hybridScore * 100),
          })}
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {sides.map(({ labelKey, post }) => (
          <section
            key={labelKey}
            aria-label={t(labelKey)}
            className="rounded-lg border border-border px-4 py-3"
          >
            <p className="text-xs font-medium text-muted-foreground uppercase">
              {t(labelKey)}
            </p>
            <p className="font-medium">{post.title}</p>
            <p className={muted}>
              {post.statusName
                ? t("duplicates.place", {
                    board: post.boardName,
                    status: post.statusName,
                  })
                : post.boardName}
            </p>
            <p className={muted}>
              {t("duplicates.votes", { count: post.voteCount })}
            </p>
          </section>
        ))}
      </div>
      {suggestion.llmReasoning ? (
        <p className={muted}>{suggestion.llmReasoning}</p>
      ) : null}
    </article>
  );
}
