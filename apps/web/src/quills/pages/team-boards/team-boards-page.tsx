import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useGetBoardSettings } from "../../hooks/team/use-get-board-settings";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListSegments } from "../../hooks/team/use-list-segments";
import { useListStatuses } from "../../hooks/team/use-list-statuses";
import { useUpdateBoard } from "../../hooks/team/use-update-board";
import { useUpdateBoardSettings } from "../../hooks/team/use-update-board-settings";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { ListHeader } from "../../ui/inbox/list-header";
import { PageFrame } from "../../ui/page-frame";
import { BoardSegments } from "./parts/board-segments";
import { BoardVotingForm } from "./parts/board-voting-form";
import { TaskSyncForm } from "./parts/task-sync-form";

export interface TeamBoardsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const heading = "text-sm font-semibold";
const select = "h-8 rounded-lg border border-input bg-background px-2 text-sm";

// The settings of one board (RFC 0004 D4): who can see it, portal voting and task sync.
export function TeamBoardsPage({ workspaceId }: TeamBoardsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const boardField = useId();
  const [chosen, setChosen] = useState("");
  const param = { workspaceId };
  // ponytail: the first 100 boards (the API maximum); page them when a workspace has more.
  const boards = useListBoards(
    { param, query: { counts: "false", offset: "0", limit: "100" } },
    team.viewer,
  );
  const segments = useListSegments({ param }, team.viewer);
  const items = boards.data?.items ?? [];
  const board = items.find((item) => item.id === chosen) ?? items[0];
  const boardId = board?.id ?? "";
  // Only a teammate with manage_settings reads and changes the voting and task sync settings.
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
  const update = useUpdateBoard(team.viewer);
  const voting = useUpdateBoardSettings(team.viewer);
  const saveSettings = async (
    json: Parameters<typeof voting.mutateAsync>[0]["json"],
  ) => {
    await voting.mutateAsync({ param: { workspaceId, boardId }, json });
  };

  return (
    <PageFrame titleKey="boards.title" variant="app" landmark={false}>
      <ListHeader
        title={t("boards.title")}
        actions={
          items.length ? (
            <span className="flex items-center gap-2 text-sm">
              <label htmlFor={boardField} className="text-muted-foreground">
                {t("team-triage.board")}
              </label>
              <select
                id={boardField}
                className={select}
                value={boardId}
                onChange={(event) => setChosen(event.target.value)}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </span>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-2xl gap-8 px-4 py-6">
          <TeamStateView
            loading={boards.isLoading || segments.isLoading}
            problem={boards.error ?? segments.error ?? null}
            onRetry={() => {
              void boards.refetch();
              void segments.refetch();
            }}
          >
            {board ? (
              <section aria-labelledby="team-boards-visibility">
                <h2 id="team-boards-visibility" className={heading}>
                  {t("boards.visibility")}
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  {t("boards.description")}
                </p>
                <BoardSegments
                  key={board.id}
                  board={board}
                  segments={segments.data?.segments ?? []}
                  onSubmit={
                    team.permissions.manageSettings
                      ? async (visibleSegmentIds) => {
                          try {
                            await update.mutateAsync({
                              param: { workspaceId, boardId },
                              json: { visibleSegmentIds },
                            });
                          } catch (problem) {
                            return problem as PortalProblem;
                          }
                        }
                      : undefined
                  }
                />
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("boards.none")}
              </p>
            )}
            {manages ? (
              <TeamStateView
                loading={settings.isLoading || statuses.isLoading}
                problem={settings.error ?? statuses.error ?? null}
                onRetry={() =>
                  void Promise.all([settings.refetch(), statuses.refetch()])
                }
              >
                {settings.data ? (
                  <>
                    <section aria-labelledby="team-boards-voting">
                      <h2 id="team-boards-voting" className={`mb-3 ${heading}`}>
                        {t("team-triage.voting")}
                      </h2>
                      <BoardVotingForm
                        key={boardId}
                        settings={settings.data}
                        onSubmit={saveSettings}
                      />
                    </section>
                    <TaskSyncForm
                      key={`${boardId}:task-sync`}
                      statusOnTaskDone={settings.data.taskSync.statusOnTaskDone}
                      statuses={statuses.data?.statuses ?? []}
                      onSubmit={(taskSync) => saveSettings({ taskSync })}
                    />
                  </>
                ) : null}
              </TeamStateView>
            ) : null}
          </TeamStateView>
        </div>
      </div>
    </PageFrame>
  );
}
