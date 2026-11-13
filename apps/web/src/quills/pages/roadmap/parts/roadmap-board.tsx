import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, useDebouncedValue } from "../../../ui/upstream";
import type { ListPortalRoadmapsResponse } from "../../../api/feedback/list-portal-roadmaps";
import type { Viewer } from "../../../core/types";
import { useListPortalRoadmapPosts } from "../../../hooks/feedback/use-list-portal-roadmap-posts";
import { StateView } from "../../../ui/state-view";
import { RoadmapColumn } from "./roadmap-column";
export interface RoadmapBoardProps {
  workspaceId: string;
  viewer: Viewer;
  roadmap: ListPortalRoadmapsResponse["roadmaps"][number];
  search: string;
  sort: "votes" | "newest" | "oldest";
}
export function RoadmapBoard(props: RoadmapBoardProps) {
  const { workspaceId, viewer, roadmap, sort } = props;
  const search = useDebouncedValue(props.search, 250);
  const { t } = useTranslation("quills");
  const [offset, setOffset] = useState(0);
  const dates = useListPortalRoadmapPosts(
    {
      param: {
        workspace: workspaceId,
        roadmapId: roadmap.type === "date" ? roadmap.id : "",
      },
      query: { offset: "0", limit: "1" },
    },
    viewer,
  );
  const columns =
    roadmap.type === "column"
      ? roadmap.columns.map((column) => ({
          id: column.id,
          label: column.name,
          statusId: column.statusId,
          bucketId: undefined,
        }))
      : (dates.data?.buckets?.map((bucket) => ({
          id: bucket.id,
          label: bucket.label,
          statusId: undefined,
          bucketId: bucket.id,
        })) ?? []);
  const start = Math.min(
    offset,
    Math.max(0, Math.ceil(columns.length / 3) - 1) * 3,
  );
  const visibleColumns =
    roadmap.type === "date" ? columns.slice(start, start + 3) : columns;
  return (
    <StateView
      loading={roadmap.type === "date" && dates.isLoading}
      problem={roadmap.type === "date" ? dates.error : null}
      empty={roadmap.type === "column" && columns.length === 0}
      onRetry={() => {
        void dates.refetch();
      }}
    >
      <div className="flex flex-col gap-4">
        {roadmap.type === "date" && columns.length > 3 ? (
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              disabled={start === 0}
              onClick={() => setOffset(start - 3)}
            >
              {t("feedback.previousPeriods")}
            </Button>
            <Button
              variant="outline"
              disabled={start + 3 >= columns.length}
              onClick={() => setOffset(start + 3)}
            >
              {t("feedback.nextPeriods")}
            </Button>
          </div>
        ) : null}
        <div className="grid items-start gap-5 lg:grid-cols-3">
          {visibleColumns.map((column) => (
            <RoadmapColumn
              key={`${column.id}:${search}:${sort}`}
              workspaceId={workspaceId}
              viewer={viewer}
              roadmapId={roadmap.id}
              label={column.label}
              statusId={column.statusId}
              bucketId={column.bucketId}
              search={search}
              sort={sort}
            />
          ))}
        </div>
      </div>
    </StateView>
  );
}
