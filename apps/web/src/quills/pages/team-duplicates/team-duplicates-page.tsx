import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAcceptSuggestion } from "../../hooks/team/use-accept-suggestion";
import { useDismissSuggestion } from "../../hooks/team/use-dismiss-suggestion";
import { useListMergeSuggestions } from "../../hooks/team/use-list-merge-suggestions";
import { useRestoreSuggestion } from "../../hooks/team/use-restore-suggestion";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import { SuggestionRow } from "./parts/suggestion-row";

export interface TeamDuplicatesPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const filters = {
  pending: "duplicates.pending",
  dismissed: "duplicates.dismissed",
} as const;
type Filter = keyof typeof filters;

/** The duplicate review queue: merge, dismiss or restore suggested pairs of posts. */
export function TeamDuplicatesPage({ workspaceId }: TeamDuplicatesPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [status, setStatus] = useState<Filter>("pending");
  const [notice, setNotice] = useState("");
  const list = useListMergeSuggestions(
    { param: { workspaceId }, query: { status, limit: "50" } },
    team.viewer,
  );
  const accept = useAcceptSuggestion(team.viewer);
  const dismiss = useDismissSuggestion(team.viewer);
  const restore = useRestoreSuggestion(team.viewer);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PageFrame
      titleKey="duplicates.title"
      description={t("duplicates.description")}
      landmark={false}
      wide
      actions={
        <div
          role="group"
          aria-label={t("duplicates.filter")}
          className="flex gap-2"
        >
          {(Object.keys(filters) as Filter[]).map((value) => (
            <Button
              key={value}
              type="button"
              variant={status === value ? "secondary" : "outline"}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {t(filters[value])}
            </Button>
          ))}
        </div>
      }
    >
      <p role="status" className="mb-3 text-sm text-muted-foreground">
        {notice}
      </p>
      <TeamStateView
        loading={list.isLoading}
        problem={list.error ?? null}
        empty={!items.length}
        onRetry={() => void list.refetch()}
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((suggestion) => {
            const param = { workspaceId, suggestionId: suggestion.id };
            const names = {
              source: suggestion.source.title,
              target: suggestion.target.title,
            };
            return (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                canDecide={team.permissions.update}
                onMerge={async () => {
                  // The source post merges into the target post.
                  await accept.mutateAsync({
                    param,
                    json: { swapDirection: false },
                  });
                  setNotice(t("duplicates.merged", names));
                }}
                onDismiss={async () => {
                  await dismiss.mutateAsync({ param });
                  setNotice(t("duplicates.dismissedPair", names));
                }}
                onRestore={async () => {
                  await restore.mutateAsync({ param });
                  setNotice(t("duplicates.restored", names));
                }}
              />
            );
          })}
        </ul>
        {list.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t("duplicates.loadMore")}
          </Button>
        ) : null}
      </TeamStateView>
    </PageFrame>
  );
}
