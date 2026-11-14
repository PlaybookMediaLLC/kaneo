import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListSegments } from "../../hooks/team/use-list-segments";
import { useUpdateBoard } from "../../hooks/team/use-update-board";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { BoardSegments } from "./parts/board-segments";

export interface TeamBoardsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

// Board settings. Each lane adds its own part to a board's section (RFC 0003 section 6).
export function TeamBoardsPage({ workspaceId }: TeamBoardsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  // ponytail: the first 100 boards (the API maximum); page them when a workspace has more.
  const boards = useListBoards(
    {
      param: { workspaceId },
      query: { counts: "false", offset: "0", limit: "100" },
    },
    team.viewer,
  );
  const segments = useListSegments({ param: { workspaceId } }, team.viewer);
  const update = useUpdateBoard(team.viewer);
  const items = boards.data?.items ?? [];

  return (
    <PageFrame
      titleKey="boards.title"
      description={t("boards.description")}
      landmark={false}
      wide
    >
      <TeamStateView
        loading={boards.isLoading || segments.isLoading}
        problem={boards.error ?? segments.error ?? null}
        onRetry={() => {
          void boards.refetch();
          void segments.refetch();
        }}
      >
        {items.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((board) => (
              <li key={board.id} className="grid gap-3 px-4 py-3">
                <h2 className="font-medium">{board.name}</h2>
                <BoardSegments
                  board={board}
                  segments={segments.data?.segments ?? []}
                  onSubmit={
                    team.permissions.manageSettings
                      ? async (visibleSegmentIds) => {
                          try {
                            await update.mutateAsync({
                              param: { workspaceId, boardId: board.id },
                              json: { visibleSegmentIds },
                            });
                          } catch (problem) {
                            return problem as PortalProblem;
                          }
                        }
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("boards.none")}</p>
        )}
      </TeamStateView>
    </PageFrame>
  );
}
