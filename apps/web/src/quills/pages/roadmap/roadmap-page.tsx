import { IconMagnifierOutline18 } from "nucleo-ui-essential-outline-18";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useListPortalBoards } from "../../hooks/feedback/use-list-portal-boards";
import { useListPortalRoadmaps } from "../../hooks/feedback/use-list-portal-roadmaps";
import { useListPortalStatuses } from "../../hooks/feedback/use-list-portal-statuses";
import { useListPortalVotedPosts } from "../../hooks/feedback/use-list-portal-voted-posts";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { PostSort } from "../../ui/post/post-sort";
import { StateView } from "../../ui/state-view";
import { Input } from "../../ui/upstream";
import { meta } from "./meta";
import { RoadmapBoard } from "./parts/roadmap-board";

export interface RoadmapPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const tab =
  "rounded-full px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground";

export function RoadmapPage(props: RoadmapPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const navigate = useNavigate();
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const workspace = canLoad ? props.workspaceId : "";
  const roadmaps = useListPortalRoadmaps({ param: { workspace } }, viewer);
  const statuses = useListPortalStatuses({ param: { workspace } }, viewer);
  const boards = useListPortalBoards(
    { param: { workspace }, query: { counts: "false" } },
    viewer,
  );
  // A visitor has no votes, so only a signed-in viewer asks.
  const voted = useListPortalVotedPosts(
    { param: { workspace: viewer.kind === "user" ? workspace : "" } },
    viewer,
  );
  const list = roadmaps.data?.roadmaps ?? [];
  const selected =
    list.find((item) => item.slug === props.search.roadmap) ??
    (props.search.roadmap ? undefined : list[0]);
  const [search, setSearch] = useState(
    typeof props.search.search === "string"
      ? props.search.search.slice(0, 200)
      : "",
  );
  // The address follows the search box after typing pauses, so typing stays fast.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const sort =
    props.search.sort === "newest" || props.search.sort === "oldest"
      ? props.search.sort
      : "votes";
  const change = (patch: Record<string, string | undefined>) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        ...patch,
      }),
      replace: true,
      resetScroll: false,
    });
  return (
    <PageFrame
      titleKey="roadmap.title"
      description={selected?.description || t("roadmap.description")}
      actions={
        <a
          className="rounded-full bg-muted px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/70"
          href={portalHref(props.workspaceId, "", { openFeedback: "1" })}
        >
          {t("roadmap.suggest")}
        </a>
      }
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
            loading={roadmaps.isLoading}
            problem={roadmaps.error}
            empty={roadmaps.data?.roadmaps.length === 0}
            onRetry={() => void roadmaps.refetch()}
          >
            <div className="flex flex-wrap items-center gap-3">
              {list.length > 1 ? (
                <div
                  role="group"
                  aria-label={t("roadmap.roadmaps")}
                  className="flex flex-wrap gap-1"
                >
                  {list.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={tab}
                      aria-pressed={item.id === selected?.id}
                      onClick={() => change({ roadmap: item.slug })}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                <div className="relative">
                  <IconMagnifierOutline18
                    aria-hidden="true"
                    className="pointer-events-none absolute start-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    size="sm"
                    className="w-44 rounded-full ps-6"
                    aria-label={t("feedback.search")}
                    placeholder={t("feedback.search")}
                    maxLength={200}
                    value={search}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSearch(value);
                      clearTimeout(timer.current);
                      timer.current = setTimeout(
                        () => change({ search: value || undefined }),
                        400,
                      );
                    }}
                  />
                </div>
                <PostSort
                  hideLabel
                  sort={sort}
                  onSortChange={(value) =>
                    change({ sort: value === "votes" ? undefined : value })
                  }
                />
              </div>
            </div>
            {selected ? (
              <RoadmapBoard
                key={selected.id}
                workspaceId={props.workspaceId}
                viewer={viewer}
                roadmap={selected}
                search={search}
                sort={sort}
                statuses={
                  new Map(
                    statuses.data?.items.map((status) => [
                      status.id,
                      { stage: status.stage, color: status.color },
                    ]),
                  )
                }
                votedIds={new Set(voted.data?.postIds)}
                canVote={(boardId) =>
                  Boolean(
                    boards.data?.items.some(
                      (board) => board.id === boardId && board.canVote,
                    ),
                  )
                }
              />
            ) : (
              <StateView problem={{ kind: "notFound" }}>{null}</StateView>
            )}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
