import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { roadmapStages } from "../../core/roadmap-stages";
import { useListPortalBoards } from "../../hooks/feedback/use-list-portal-boards";
import { useListPortalStatuses } from "../../hooks/feedback/use-list-portal-statuses";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { RoadmapColumn } from "./parts/roadmap-column";

export interface RoadmapPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function RoadmapPage(props: RoadmapPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const workspace = canLoad ? props.workspaceId : "";
  const statuses = useListPortalStatuses({ param: { workspace } }, viewer);
  const boards = useListPortalBoards(
    { param: { workspace }, query: { counts: "false" } },
    viewer,
  );
  const stages = roadmapStages(statuses.data?.items ?? []);

  return (
    <PageFrame
      titleKey="roadmap.title"
      description={t("roadmap.description")}
      wide
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "roadmap")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={viewer.kind === "user"}
        >
          <StateView
            loading={statuses.isLoading || boards.isLoading}
            empty={statuses.isSuccess && stages.length === 0}
            problem={statuses.error ?? boards.error ?? null}
            onRetry={() => {
              void statuses.refetch();
              void boards.refetch();
            }}
          >
            <div className="portal-roadmap grid items-start gap-6 md:grid-cols-3 md:gap-4">
              {stages.map((stage) => (
                <RoadmapColumn
                  key={stage.value}
                  workspaceId={props.workspaceId}
                  viewer={viewer}
                  stage={stage}
                  canVote={(boardId) =>
                    Boolean(
                      boards.data?.items.some(
                        (board) => board.id === boardId && board.canVote,
                      ),
                    )
                  }
                />
              ))}
            </div>
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
