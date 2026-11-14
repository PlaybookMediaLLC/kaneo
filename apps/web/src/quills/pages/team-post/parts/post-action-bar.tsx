import { Check, ChevronDown, CircleX, Merge } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { useSetPostStatus } from "../../../hooks/team/use-set-post-status";
import { useTeamRuntime } from "../../../team/runtime";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import { PostStatusIcon } from "../../../ui/inbox/post-status-icon";
import {
  Button,
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  toast,
} from "../../../ui/upstream";
import { statusIcon } from "../../team-posts/post-list";
import { statusMoves } from "../status-moves";

export interface PostActionBarProps {
  workspaceId: string;
  post: GetPostResponse;
  statuses: ListStatusesResponse["statuses"];
  /** Opens the merge palette. */
  onMerge: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** The floating bar of a request: the status picker, Merge, Close and the next status. */
export function PostActionBar(props: PostActionBarProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const set = useSetPostStatus(team.viewer);
  // A pending change shows at once; the refreshed post confirms it.
  const statusId = set.isPending
    ? set.variables.json.statusId
    : props.post.statusId;
  const ordered = [...props.statuses].sort((a, b) => a.position - b.position);
  const current = ordered.find((status) => status.id === statusId);
  const moves = statusMoves(ordered, statusId);
  const locked = !team.permissions.update || set.isPending;
  const move = (id: string) =>
    set.mutate(
      {
        param: { workspaceId: props.workspaceId, postId: props.post.id },
        json: { statusId: id },
      },
      { onError: () => toast.error(t("core.problem.failed")) },
    );
  const name = current?.name ?? t("team-post.noStatus");
  return (
    <FloatingActionBar
      label={t("team-post.actions")}
      status={
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                disabled={locked}
                aria-label={t("team-post.statusIs", { status: name })}
              />
            }
          >
            <PostStatusIcon {...statusIcon({ statusId }, ordered)} />
            {name}
            <ChevronDown aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup side="top" align="start">
            <MenuRadioGroup
              value={statusId ?? ""}
              onValueChange={(value) => move(String(value))}
            >
              {ordered.map((status) => (
                <MenuRadioItem key={status.id} value={status.id}>
                  <span className="flex items-center gap-2">
                    <PostStatusIcon
                      {...statusIcon({ statusId: status.id }, ordered)}
                    />
                    {status.name}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      }
      actions={[
        {
          id: "merge",
          label: t("team-post.merge"),
          icon: Merge,
          onSelect: props.onMerge,
          disabled:
            !team.permissions.update || Boolean(props.post.canonicalPostId),
        },
        {
          id: "close",
          label: t("team-post.close"),
          icon: CircleX,
          onSelect: () => moves.close && move(moves.close.id),
          disabled: locked || !moves.close,
        },
      ]}
      primary={
        moves.next
          ? {
              id: "next",
              label: moves.accept
                ? t("team-post.accept")
                : t("team-post.moveTo", { status: moves.next.name }),
              icon: Check,
              onSelect: () => moves.next && move(moves.next.id),
              disabled: locked,
            }
          : undefined
      }
      onPrevious={props.onPrevious}
      onNext={props.onNext}
    />
  );
}
