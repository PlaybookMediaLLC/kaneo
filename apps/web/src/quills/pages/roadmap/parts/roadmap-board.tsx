import {
  IconChevronLeftOutline18,
  IconChevronRightOutline18,
} from "nucleo-ui-essential-outline-18";
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
  /** Workspace statuses by ID, for the column icons and descriptions. */
  statuses?: ReadonlyMap<
    string,
    { stage: string | null; color: string | null }
  >;
  votedIds?: ReadonlySet<string>;
  canVote?: (boardId: string) => boolean;
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
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("feedback.previousPeriods")}
              disabled={start === 0}
              onClick={() => setOffset(start - 3)}
            >
              <IconChevronLeftOutline18 aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("feedback.nextPeriods")}
              disabled={start + 3 >= columns.length}
              onClick={() => setOffset(start + 3)}
            >
              <IconChevronRightOutline18 aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <div className="portal-roadmap grid items-start gap-6 md:grid-cols-3 md:gap-4">
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
              status={
                column.statusId
                  ? props.statuses?.get(column.statusId)
                  : undefined
              }
              votedIds={props.votedIds}
              canVote={props.canVote}
            />
          ))}
        </div>
      </div>
    </StateView>
  );
}
