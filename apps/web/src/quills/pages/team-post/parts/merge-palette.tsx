import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { useListPosts } from "../../../hooks/team/use-list-posts";
import { useMergePost } from "../../../hooks/team/use-merge-post";
import { useTeamRuntime } from "../../../team/runtime";
import { CommandPalette } from "../../../ui/inbox/command-palette";
import { PostStatusIcon } from "../../../ui/inbox/post-status-icon";
import { toast, useDebouncedValue } from "../../../ui/upstream";
import { statusIcon } from "../../team-posts/post-list";

/** "into" merges the open request into the chosen one; "here" merges the chosen one into it. */
export type MergeMode = "into" | "here";

export interface MergePaletteProps {
  workspaceId: string;
  post: GetPostResponse;
  statuses: ListStatusesResponse["statuses"];
  mode: MergeMode;
  onClose: () => void;
}

const copy = {
  into: { chip: "team-post.mergeInto", find: "team-post.findMain" },
  here: { chip: "team-post.mergeHereChip", find: "team-post.findDuplicate" },
} as const;

/** The merge palette: a search over the requests, and a merge of the chosen one. Unmerge undoes it. */
export function MergePalette(props: MergePaletteProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const found = useListPosts(
    {
      param: { workspaceId: search ? props.workspaceId : "" },
      query: { search, sort: "votes", limit: "8" },
    },
    team.viewer,
  );
  const merge = useMergePost(team.viewer);
  const items = (found.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => item.id !== props.post.id,
  );
  return (
    <CommandPalette
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      label={t(copy[props.mode].chip)}
      chip={t(copy[props.mode].chip)}
      placeholder={t(copy[props.mode].find)}
      query={query}
      onQueryChange={setQuery}
      items={search ? items : []}
      getKey={(item) => item.id}
      loading={Boolean(search) && found.isFetching}
      renderItem={(item) => (
        <span className="flex items-center gap-2">
          <PostStatusIcon {...statusIcon(item, props.statuses)} />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <span className="text-xs text-muted-foreground">
            {t("team-post.votes", { count: item.voteCount })}
          </span>
        </span>
      )}
      onSelect={(item) => {
        if (merge.isPending) return;
        const [duplicate, main] =
          props.mode === "into"
            ? [props.post.id, item.id]
            : [item.id, props.post.id];
        merge.mutate(
          {
            param: { workspaceId: props.workspaceId, postId: duplicate },
            json: { canonicalPostId: main },
          },
          {
            onSuccess: () => {
              toast.success(t("team-post.merged"));
              props.onClose();
            },
            onError: () => toast.error(t("core.problem.failed")),
          },
        );
      }}
    />
  );
}
