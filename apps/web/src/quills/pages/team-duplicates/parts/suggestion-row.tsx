import { useTranslation } from "react-i18next";
import type { ListMergeSuggestionsResponse } from "../../../api/team/list-merge-suggestions";
import { ConfirmAction } from "../../../ui/confirm-action";

export interface SuggestionRowProps {
  suggestion: ListMergeSuggestionsResponse["items"][number];
  /** Hides the actions. The teammate API still decides. */
  canDecide: boolean;
  onMerge: () => Promise<void>;
  onDismiss: () => Promise<void>;
  onRestore: () => Promise<void>;
}

const muted = "text-sm text-muted-foreground";

/** One suggested pair: the duplicate, the post to keep, and the decisions. */
export function SuggestionRow({ suggestion, ...props }: SuggestionRowProps) {
  const { t } = useTranslation("quills");
  const names = {
    source: suggestion.source.title,
    target: suggestion.target.title,
  };
  const sides = [
    { labelKey: "duplicates.duplicate", post: suggestion.source },
    { labelKey: "duplicates.keep", post: suggestion.target },
  ];
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {sides.map(({ labelKey, post }) => (
          <div key={labelKey}>
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
          </div>
        ))}
      </div>
      <p className={muted}>
        {t("duplicates.match", {
          percent: Math.round(suggestion.hybridScore * 100),
        })}
      </p>
      {suggestion.llmReasoning ? (
        <p className={muted}>{suggestion.llmReasoning}</p>
      ) : null}
      {props.canDecide ? (
        <div className="flex flex-wrap gap-2">
          {suggestion.status === "pending" ? (
            <>
              <ConfirmAction
                labelKey="duplicates.mergeFor"
                labelValues={names}
                onConfirm={props.onMerge}
              >
                {t("duplicates.merge")}
              </ConfirmAction>
              <ConfirmAction
                labelKey="duplicates.dismissFor"
                labelValues={names}
                onConfirm={props.onDismiss}
              >
                {t("duplicates.dismiss")}
              </ConfirmAction>
            </>
          ) : (
            <ConfirmAction
              labelKey="duplicates.restoreFor"
              labelValues={names}
              onConfirm={props.onRestore}
            >
              {t("duplicates.restore")}
            </ConfirmAction>
          )}
        </div>
      ) : null}
    </li>
  );
}
