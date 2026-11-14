import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import { useListMergedPosts } from "../../../hooks/team/use-list-merged-posts";
import { useListPosts } from "../../../hooks/team/use-list-posts";
import { useMergePost } from "../../../hooks/team/use-merge-post";
import { useUnmergePost } from "../../../hooks/team/use-unmerge-post";
import { useTeamRuntime } from "../../../team/runtime";
import { teamHref } from "../../../team/team-href";
import { Button, Input, useDebouncedValue } from "../../../ui/upstream";

export interface PostMergeProps {
  workspaceId: string;
  post: GetPostResponse;
}

/** Merge a post into another post, and the duplicates merged into this one. Unmerge undoes both. */
export function PostMerge({ workspaceId, post }: PostMergeProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<{ id: string; title: string } | null>(
    null,
  );
  const query = useDebouncedValue(text.trim(), 300);
  const param = { workspaceId, postId: post.id };
  const merged = useListMergedPosts(
    { param, query: { limit: "50" } },
    team.viewer,
  );
  const found = useListPosts(
    {
      param: { workspaceId: query ? workspaceId : "" },
      query: { search: query, sort: "votes", limit: "5" },
    },
    team.viewer,
  );
  const merge = useMergePost(team.viewer);
  const unmerge = useUnmergePost(team.viewer);
  const locked = !team.permissions.update;
  const failed = merged.error ?? found.error ?? merge.error ?? unmerge.error;
  const href = (postId: string) =>
    teamHref(workspaceId, `/posts/${encodeURIComponent(postId)}`);
  const candidates = (
    found.data?.pages.flatMap((page) => page.items) ?? []
  ).filter((item) => item.id !== post.id);
  const duplicates = merged.data?.posts ?? [];
  return (
    <section aria-labelledby={heading} className="grid gap-2 py-2 text-sm">
      <h3 id={heading} className="font-medium">
        {t("team-post.merge")}
      </h3>
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
      ) : locked ? null : target ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={merge.isPending}
            onClick={() =>
              merge.mutate(
                { param, json: { canonicalPostId: target.id } },
                { onSuccess: () => setTarget(null) },
              )
            }
          >
            {t("team-post.mergeInto", { title: target.title })}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
            {t("team-post.cancel")}
          </Button>
        </div>
      ) : (
        <>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("team-post.mergeSearch")}
            <Input
              type="search"
              size="sm"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {query ? (
            <ul className="grid gap-1">
              {candidates.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      setTarget({ id: item.id, title: item.title });
                      setText("");
                    }}
                  >
                    {item.title}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <h3 className="mt-2 font-medium">
        {t("team-post.duplicates", { count: duplicates.length })}
      </h3>
      <ul className="grid gap-1">
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
