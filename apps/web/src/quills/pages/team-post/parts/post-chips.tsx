import { EyeOff, Globe, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import { useListTags } from "../../../hooks/team/use-list-tags";
import { useSetPostBoard } from "../../../hooks/team/use-set-post-board";
import { useSetPostTags } from "../../../hooks/team/use-set-post-tags";
import { useTeamRuntime } from "../../../team/runtime";
import {
  Button,
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  toast,
} from "../../../ui/upstream";

export interface PostChipsProps {
  workspaceId: string;
  post: GetPostResponse;
  boards: ListBoardsResponse["items"];
}

const chip =
  "h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-medium uppercase tracking-wide";

/** The chip row under a request: its board, its visibility on the board, and its tags. */
export function PostChips({ workspaceId, post, boards }: PostChipsProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [tagging, setTagging] = useState(false);
  const param = { workspaceId, postId: post.id };
  // ponytail: the first 100 tags (the API maximum), loaded when the tag menu opens.
  const tags = useListTags(
    {
      param: { workspaceId: tagging ? workspaceId : "" },
      query: { limit: "100" },
    },
    team.viewer,
  );
  const board = useSetPostBoard(team.viewer);
  const setTags = useSetPostTags(team.viewer);
  const locked = !team.permissions.update;
  const failed = { onError: () => toast.error(t("core.problem.failed")) };
  // A pending change shows at once; the refreshed post confirms it.
  const boardId = board.isPending ? board.variables.json.boardId : post.boardId;
  const tagIds = setTags.isPending
    ? setTags.variables.json.tagIds
    : post.tags.map((tag) => tag.id);
  const published = post.moderationState === "published";
  const Visibility = published ? Globe : EyeOff;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={chip}
              disabled={locked || board.isPending}
              aria-label={t("team-post.boardIs", {
                board: boards.find((item) => item.id === boardId)?.name ?? "",
              })}
            />
          }
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
          {boards.find((item) => item.id === boardId)?.name}
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup
            value={boardId}
            onValueChange={(value) =>
              board.mutate({ param, json: { boardId: String(value) } }, failed)
            }
          >
            {boards.map((item) => (
              <MenuRadioItem key={item.id} value={item.id}>
                {item.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground">
        <Visibility aria-hidden="true" className="size-3.5" />
        {published ? t("team-post.onBoard") : t("team-post.notOnBoard")}
      </span>
      {post.tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex h-7 items-center rounded-full bg-muted px-2.5 text-xs"
        >
          {tag.name}
        </span>
      ))}
      {locked ? null : (
        <Menu open={tagging} onOpenChange={setTagging}>
          <MenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                className="size-7 rounded-full"
                aria-label={t("team-post.editTags")}
                disabled={setTags.isPending}
              />
            }
          >
            <Plus aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="start">
            {tags.data && !tags.data.tags.length ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                {t("team-post.noTags")}
              </p>
            ) : null}
            {tags.data?.tags.map((tag) => {
              const on = tagIds.includes(tag.id);
              return (
                <MenuCheckboxItem
                  key={tag.id}
                  checked={on}
                  onCheckedChange={() =>
                    setTags.mutate(
                      {
                        param,
                        json: {
                          tagIds: on
                            ? tagIds.filter((id) => id !== tag.id)
                            : [...tagIds, tag.id],
                        },
                      },
                      failed,
                    )
                  }
                >
                  {tag.name}
                </MenuCheckboxItem>
              );
            })}
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}
