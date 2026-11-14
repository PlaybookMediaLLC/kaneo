import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetBoardSettings } from "../../hooks/team/use-get-board-settings";
import { useGetRevenueAtRisk } from "../../hooks/team/use-get-revenue-at-risk";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListPosts } from "../../hooks/team/use-list-posts";
import { useListStatuses } from "../../hooks/team/use-list-statuses";
import { useSetPostScore } from "../../hooks/team/use-set-post-score";
import { useUpdateBoardSettings } from "../../hooks/team/use-update-board-settings";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import { BoardVotingForm } from "./parts/board-voting-form";
import { TaskSyncForm } from "./parts/task-sync-form";
import { TriageTable } from "./parts/triage-table";

export interface TeamTriagePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const sorts = [
  { value: "votes", labelKey: "team-triage.sortVotes" },
  { value: "mrr", labelKey: "team-triage.sortMrr" },
  { value: "rice", labelKey: "team-triage.sortRice" },
] as const;
const heading = "text-base font-semibold";
const select = "h-9 rounded-lg border border-input bg-background px-3 text-sm";

// Requests ranked by votes, customer revenue or RICE, with the revenue at risk and portal voting settings.
export function TeamTriagePage({ workspaceId }: TeamTriagePageProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const [sort, setSort] = useState<(typeof sorts)[number]["value"]>("votes");
  const [editing, setEditing] = useState<string | null>(null);
  const [chosenBoard, setChosenBoard] = useState("");
  const param = { workspaceId };
  const posts = useListPosts(
    { param, query: { sort, limit: "50" } },
    team.viewer,
  );
  const risk = useGetRevenueAtRisk({ param }, team.viewer);
  // ponytail: the first 100 boards (the API maximum); page them when a workspace has more.
  const boards = useListBoards(
    { param, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  const boardId = chosenBoard || boards.data?.items[0]?.id || "";
  const manages = team.permissions.manageSettings && Boolean(boardId);
  const scope = manages ? workspaceId : "";
  const settings = useGetBoardSettings(
    { param: { workspaceId: scope, boardId } },
    team.viewer,
  );
  // ponytail: the first 100 statuses (the API maximum) for the task sync choice.
  const statuses = useListStatuses(
    { param: { workspaceId: scope }, query: { limit: "100" } },
    team.viewer,
  );
  const score = useSetPostScore(team.viewer);
  const voting = useUpdateBoardSettings(team.viewer);
  const money = (cents: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
      cents / 100,
    );

  return (
    <PageFrame
      titleKey="team-triage.title"
      description={t("team-triage.description")}
      landmark={false}
      wide
    >
      <TeamStateView
        loading={posts.isLoading || risk.isLoading || boards.isLoading}
        problem={posts.error ?? risk.error ?? boards.error ?? null}
        onRetry={() => {
          void posts.refetch();
          void risk.refetch();
          void boards.refetch();
        }}
      >
        <section aria-labelledby="team-triage-risk">
          <h2 id="team-triage-risk" className={heading}>
            {t("team-triage.risk")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("team-triage.riskValue", {
              amount: money(risk.data?.mrrCents ?? 0),
              count: risk.data?.companies ?? 0,
            })}
          </p>
        </section>
        <section aria-labelledby="team-triage-posts" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="team-triage-posts" className={heading}>
              {t("team-triage.posts")}
            </h2>
            <div
              role="group"
              aria-label={t("team-triage.sort")}
              className="flex gap-1"
            >
              {sorts.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  size="sm"
                  variant={sort === item.value ? "secondary" : "ghost"}
                  aria-pressed={sort === item.value}
                  onClick={() => setSort(item.value)}
                >
                  {t(item.labelKey)}
                </Button>
              ))}
            </div>
          </div>
          <TriageTable
            posts={posts.data?.pages.flatMap((page) => page.items) ?? []}
            money={money}
            canScore={team.permissions.update}
            editingId={editing}
            onEdit={setEditing}
            onScore={async (postId, json) => {
              await score.mutateAsync({ param: { workspaceId, postId }, json });
              setEditing(null);
            }}
          />
          {posts.hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              loading={posts.isFetchingNextPage}
              onClick={() => void posts.fetchNextPage()}
            >
              {t("team-triage.loadMore")}
            </Button>
          ) : null}
        </section>
        {manages ? (
          <section aria-labelledby="team-triage-voting" className="grid gap-3">
            <h2 id="team-triage-voting" className={heading}>
              {t("team-triage.voting")}
            </h2>
            <label className="grid max-w-xs gap-1 text-sm">
              {t("team-triage.board")}
              <select
                className={select}
                value={boardId}
                onChange={(event) => setChosenBoard(event.target.value)}
              >
                {boards.data?.items.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </label>
            <TeamStateView
              loading={settings.isLoading || statuses.isLoading}
              problem={settings.error ?? statuses.error ?? null}
              onRetry={() =>
                void Promise.all([settings.refetch(), statuses.refetch()])
              }
            >
              {settings.data ? (
                <>
                  <BoardVotingForm
                    key={boardId}
                    settings={settings.data}
                    onSubmit={async (json) => {
                      await voting.mutateAsync({
                        param: { workspaceId, boardId },
                        json,
                      });
                    }}
                  />
                  <TaskSyncForm
                    key={`${boardId}:task-sync`}
                    statusOnTaskDone={settings.data.taskSync.statusOnTaskDone}
                    statuses={statuses.data?.statuses ?? []}
                    onSubmit={async (taskSync) => {
                      await voting.mutateAsync({
                        param: { workspaceId, boardId },
                        json: { taskSync },
                      });
                    }}
                  />
                </>
              ) : null}
            </TeamStateView>
          </section>
        ) : null}
      </TeamStateView>
    </PageFrame>
  );
}
