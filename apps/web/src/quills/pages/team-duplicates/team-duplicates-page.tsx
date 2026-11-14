import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useAcceptSuggestion } from "../../hooks/team/use-accept-suggestion";
import { useDismissSuggestion } from "../../hooks/team/use-dismiss-suggestion";
import { useListMergeSuggestions } from "../../hooks/team/use-list-merge-suggestions";
import { useRestoreSuggestion } from "../../hooks/team/use-restore-suggestion";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListHeader } from "../../ui/inbox/list-header";
import { StatusTabs } from "../../ui/inbox/status-tabs";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import type { Suggestion } from "./parts/suggestion-detail";
import { SuggestionListRow } from "./parts/suggestion-list-row";
import { SuggestionView } from "./parts/suggestion-view";

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
// The scroll area under the header. The loading, empty and error states get a margin.
const body =
  "min-h-0 flex-1 overflow-y-auto [&>[role=alert]]:m-4 [&>[role=status]]:px-4";

/** The duplicate review queue: the pairs of posts by board, and the open pair with its decisions. */
export function TeamDuplicatesPage({ workspaceId }: TeamDuplicatesPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [status, setStatus] = useState<Filter>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<PortalProblem | null>(null);
  const list = useListMergeSuggestions(
    { param: { workspaceId }, query: { status, limit: "50" } },
    team.viewer,
  );
  const accept = useAcceptSuggestion(team.viewer);
  const dismiss = useDismissSuggestion(team.viewer);
  const restore = useRestoreSuggestion(team.viewer);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  // One group for each board of the duplicate posts.
  const groups = [...new Set(items.map((item) => item.source.boardName))].map(
    (board) => ({
      id: board,
      label: board,
      items: items.filter((item) => item.source.boardName === board),
    }),
  );
  const ordered = groups.flatMap((group) => group.items);
  const ids = ordered.map((item) => item.id);
  const open = items.find((item) => item.id === openId);
  useListNavigation({
    ids,
    activeId: cursor,
    onMove: setCursor,
    onOpen: setOpenId,
    enabled: !open,
  });
  /** Runs a decision, then opens the next pair: the decided one leaves this list. */
  const decide = (
    item: Suggestion,
    run: () => Promise<unknown>,
    key: string,
  ) => {
    const index = ids.indexOf(item.id);
    setProblem(null);
    run().then(
      () => {
        setMessage(
          t(key, { source: item.source.title, target: item.target.title }),
        );
        setOpenId(ids[index + 1] ?? ids[index - 1] ?? null);
      },
      (error: PortalProblem) => setProblem(error),
    );
  };
  const href = teamHref(workspaceId, "/duplicates");
  const param = { workspaceId, suggestionId: open?.id ?? "" };

  return (
    <PageFrame
      titleKey={open ? "duplicates.detail" : "duplicates.title"}
      displayTitle={open?.source.title}
      variant="app"
      landmark={false}
    >
      {open ? (
        <SuggestionView
          workspaceId={workspaceId}
          suggestion={open}
          suggestions={ordered}
          message={message}
          problem={problem}
          onMove={(id) => {
            setProblem(null);
            setOpenId(id);
          }}
          onBack={() => {
            setCursor(open.id);
            setOpenId(null);
          }}
          actions={{
            canDecide: team.permissions.update,
            busy: accept.isPending || dismiss.isPending || restore.isPending,
            // The duplicate (source) merges into the post to keep (target).
            onMerge: () =>
              decide(
                open,
                () =>
                  accept.mutateAsync({ param, json: { swapDirection: false } }),
                "duplicates.merged",
              ),
            onDismiss: () =>
              decide(
                open,
                () => dismiss.mutateAsync({ param }),
                "duplicates.dismissedPair",
              ),
            onRestore: () =>
              decide(
                open,
                () => restore.mutateAsync({ param }),
                "duplicates.restored",
              ),
          }}
        />
      ) : (
        <>
          <ListHeader title={t("duplicates.title")} />
          <StatusTabs
            label={t("duplicates.filter")}
            tabs={(Object.keys(filters) as Filter[]).map((value) => ({
              value,
              label: t(filters[value]),
            }))}
            value={status}
            onChange={(value) => {
              setStatus(value as Filter);
              setCursor(null);
            }}
          />
          <div className={body}>
            <p
              role="status"
              className="text-sm text-muted-foreground [&:not(:empty)]:py-2"
            >
              {message}
            </p>
            <TeamStateView
              loading={list.isLoading}
              problem={list.error ?? null}
              empty={!items.length}
              onRetry={() => void list.refetch()}
            >
              <GroupedList
                label={t("duplicates.title")}
                groups={groups}
                getKey={(item) => item.id}
                renderItem={(item) => (
                  <SuggestionListRow
                    suggestion={item}
                    href={href}
                    selected={item.id === cursor}
                    onOpen={() => setOpenId(item.id)}
                  />
                )}
              />
              {list.hasNextPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {t("duplicates.loadMore")}
                </Button>
              ) : null}
            </TeamStateView>
          </div>
        </>
      )}
    </PageFrame>
  );
}
