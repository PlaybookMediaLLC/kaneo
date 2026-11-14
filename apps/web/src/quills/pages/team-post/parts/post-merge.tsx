import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import { useListMergedPosts } from "../../../hooks/team/use-list-merged-posts";
import { useUnmergePost } from "../../../hooks/team/use-unmerge-post";
import { useTeamRuntime } from "../../../team/runtime";
import { teamHref } from "../../../team/team-href";
import { Button } from "../../../ui/upstream";

export interface PostMergeProps {
  workspaceId: string;
  post: GetPostResponse;
}

/** Where a merged post went, and the duplicates merged into this one. Unmerge undoes both. */
export function PostMerge({ workspaceId, post }: PostMergeProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const param = { workspaceId, postId: post.id };
  const merged = useListMergedPosts(
    { param, query: { limit: "50" } },
    team.viewer,
  );
  const unmerge = useUnmergePost(team.viewer);
  const locked = !team.permissions.update;
  const failed = merged.error ?? unmerge.error;
  const href = (postId: string) =>
    teamHref(workspaceId, `/posts/${encodeURIComponent(postId)}`);
  const duplicates = merged.data?.posts ?? [];
  return (
    <section aria-labelledby={heading} className="grid gap-2 py-2 text-sm">
      {failed ? (
        <p role="alert" className="text-destructive-foreground">
          {t("core.problem.failed")}
        </p>
      ) : null}
      {post.canonicalPostId ? (
        <div className="grid justify-items-start gap-2">
          <p>{t("team-post.mergedInto")}</p>
          <Link to={href(post.canonicalPostId)} className="underline">
            {t("team-post.openMain")}
          </Link>
          {locked ? null : (
            <Button
              variant="outline"
              size="sm"
              loading={unmerge.isPending}
              onClick={() => unmerge.mutate({ param })}
            >
              {t("team-post.unmerge")}
            </Button>
          )}
        </div>
      ) : null}
      <h3 id={heading} className="font-medium">
        {t("team-post.duplicates", { count: duplicates.length })}
      </h3>
      <ul className="grid grid-cols-1 gap-1">
        {duplicates.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <Link
              to={href(item.id)}
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {item.title}
            </Link>
            <span className="text-xs text-muted-foreground">
              {t("team-post.votes", { count: item.voteCount })}
            </span>
            {locked ? null : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("team-post.unmergePost", { title: item.title })}
                disabled={unmerge.isPending}
                onClick={() =>
                  unmerge.mutate({ param: { workspaceId, postId: item.id } })
                }
              >
                {t("team-post.unmerge")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
