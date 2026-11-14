import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { useListTags } from "../../../hooks/team/use-list-tags";
import { useSetPostBoard } from "../../../hooks/team/use-set-post-board";
import { useSetPostStatus } from "../../../hooks/team/use-set-post-status";
import { useSetPostTags } from "../../../hooks/team/use-set-post-tags";
import { useTeamRuntime } from "../../../team/runtime";
import { PropertyRow } from "../../../ui/inbox/property-row";

export interface PostFieldsProps {
  workspaceId: string;
  post: GetPostResponse;
  statuses: ListStatusesResponse["statuses"];
  boards: ListBoardsResponse["items"];
}

const select =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-64";

/** The status, board and tags pickers and the author of a post. */
export function PostFields({
  workspaceId,
  post,
  statuses,
  boards,
}: PostFieldsProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId, postId: post.id };
  // ponytail: the first 100 tags (the API maximum); page them when a workspace has more.
  const tags = useListTags(
    { param: { workspaceId }, query: { limit: "100" } },
    team.viewer,
  );
  const status = useSetPostStatus(team.viewer);
  const board = useSetPostBoard(team.viewer);
  const tagging = useSetPostTags(team.viewer);
  const locked = !team.permissions.update;
  // A pending change shows at once; the refreshed post confirms it.
  const statusId = status.isPending
    ? status.variables.json.statusId
    : (post.statusId ?? "");
  const boardId = board.isPending ? board.variables.json.boardId : post.boardId;
  const tagIds = tagging.isPending
    ? tagging.variables.json.tagIds
    : post.tags.map((tag) => tag.id);
  const failed = status.error ?? board.error ?? tagging.error ?? tags.error;
  return (
    <div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {t("core.problem.failed")}
        </p>
      ) : null}
      <PropertyRow label={t("team-post.status")}>
        <select
          aria-label={t("team-post.status")}
          className={select}
          value={statusId}
          disabled={locked || status.isPending}
          onChange={(event) =>
            status.mutate({ param, json: { statusId: event.target.value } })
          }
        >
          {statusId ? null : (
            <option value="">{t("team-post.noStatus")}</option>
          )}
          {statuses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </PropertyRow>
      <PropertyRow label={t("team-post.board")}>
        <select
          aria-label={t("team-post.board")}
          className={select}
          value={boardId}
          disabled={locked || board.isPending}
          onChange={(event) =>
            board.mutate({ param, json: { boardId: event.target.value } })
          }
        >
          {boards.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </PropertyRow>
      <PropertyRow label={t("team-post.tags")}>
        <fieldset
          aria-label={t("team-post.tags")}
          className="flex flex-wrap gap-1"
        >
          {tags.data?.tags.length ? null : (
            <span className="text-muted-foreground">
              {t("team-post.noTags")}
            </span>
          )}
          {tags.data?.tags.map((tag) => {
            const on = tagIds.includes(tag.id);
            return (
              <label
                key={tag.id}
                className="flex items-center gap-1 rounded-md border border-border px-1.5 text-xs has-checked:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked || tagging.isPending}
                  onChange={() =>
                    tagging.mutate({
                      param,
                      json: {
                        tagIds: on
                          ? tagIds.filter((id) => id !== tag.id)
                          : [...tagIds, tag.id],
                      },
                    })
                  }
                />
                {tag.name}
              </label>
            );
          })}
        </fieldset>
      </PropertyRow>
      <PropertyRow label={t("team-post.author")}>
        {post.authorName ?? t("team-post.anonymous")}
      </PropertyRow>
    </div>
  );
}
