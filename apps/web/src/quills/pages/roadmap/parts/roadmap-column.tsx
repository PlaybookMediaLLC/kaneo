import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Viewer } from "../../../core/types";
import { portalHref } from "../../../core/portal-href";
import { useListPortalRoadmapPosts } from "../../../hooks/feedback/use-list-portal-roadmap-posts";
import { StateView } from "../../../ui/state-view";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "../../../ui/upstream";
export interface RoadmapColumnProps {
  workspaceId: string;
  viewer: Viewer;
  roadmapId: string;
  label: string;
  statusId?: string;
  bucketId?: string;
  search: string;
  sort: "votes" | "newest" | "oldest";
}
export function RoadmapColumn(props: RoadmapColumnProps) {
  const { t, i18n } = useTranslation("quills");
  const [offset, setOffset] = useState(0);
  const posts = useListPortalRoadmapPosts(
    {
      param: { workspace: props.workspaceId, roadmapId: props.roadmapId },
      query: {
        statusId: props.statusId,
        bucketId: props.bucketId,
        search: props.search.trim() || undefined,
        sort: props.sort,
        offset: String(offset),
        limit: "10",
      },
    },
    props.viewer,
  );
  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-xl bg-muted/40 p-3"
      aria-label={props.label}
    >
      <h2 className="flex items-center justify-between gap-3 px-1 text-sm font-semibold">
        {props.label}
        <span className="text-muted-foreground tabular-nums">
          {posts.data?.total ?? ""}
        </span>
      </h2>
      <StateView
        loading={posts.isLoading}
        problem={posts.error}
        empty={posts.data?.items.length === 0}
        onRetry={() => {
          void posts.refetch();
        }}
      >
        {posts.data?.items.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <CardDescription>{post.board.name}</CardDescription>
              <CardTitle>
                <a
                  className="block break-words hover:underline"
                  href={portalHref(props.workspaceId, `posts/${post.id}`)}
                >
                  {post.title}
                </a>
              </CardTitle>
            </CardHeader>
            <CardFooter className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{t("feedback.voteCount", { count: post.voteCount })}</span>
              <span>
                {t("feedback.comments", { count: post.commentCount })}
              </span>
              {post.eta ? (
                <time dateTime={post.eta}>
                  {new Intl.DateTimeFormat(i18n.language, {
                    timeZone: "UTC",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(post.eta))}
                </time>
              ) : null}
            </CardFooter>
          </Card>
        ))}
      </StateView>
      {offset > 0 || posts.data?.hasMore ? (
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || posts.isFetching}
            onClick={() => setOffset((value) => Math.max(0, value - 10))}
          >
            {t("feedback.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!posts.data?.hasMore || posts.isFetching}
            onClick={() => setOffset((value) => value + 10)}
          >
            {t("feedback.next")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
