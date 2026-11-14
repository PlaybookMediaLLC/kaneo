import { useTranslation } from "react-i18next";
import type { ListMergeSuggestionsResponse } from "../../../api/team/list-merge-suggestions";

export type Suggestion = ListMergeSuggestionsResponse["items"][number];

export interface SuggestionDetailProps {
  suggestion: Suggestion;
}

const muted = "text-sm text-muted-foreground";

/** The body of the open pair under its header: the duplicate, the post to keep and the reason. */
export function SuggestionDetail({ suggestion }: SuggestionDetailProps) {
  const { t } = useTranslation("quills");
  const sides = [
    { labelKey: "duplicates.duplicate", post: suggestion.source },
    { labelKey: "duplicates.keep", post: suggestion.target },
  ];
  return (
    <article className="mx-auto grid w-full max-w-3xl gap-4 px-6 py-5">
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
