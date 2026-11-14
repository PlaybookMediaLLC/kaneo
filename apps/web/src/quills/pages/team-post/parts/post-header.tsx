import { Merge } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import { useTeamRuntime } from "../../../team/runtime";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { IconButton } from "../../../ui/inbox/icon-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../../ui/upstream";
import type { MergeMode } from "./merge-palette";
import { PostMenu } from "./post-menu";

export interface PostHeaderProps {
  workspaceId: string;
  post: GetPostResponse | undefined;
  /** The board of the post, as the text of the back button. */
  boardName?: string;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onMerge: (mode: MergeMode) => void;
  onDeleted: () => void;
}

/** The top row of a request: back to the board's list, the merge menu, the arrows and the kebab. */
export function PostHeader({ post, ...props }: PostHeaderProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  return (
    <DetailHeader
      onBack={props.onBack}
      backLabel={props.boardName}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
      actions={
        post ? (
          <>
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    label={t("team-post.mergeMenu")}
                    disabled={
                      !team.permissions.update || Boolean(post.canonicalPostId)
                    }
                  />
                }
              >
                <Merge aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => props.onMerge("into")}>
                  {t("team-post.mergeWithOther")}
                </MenuItem>
                <MenuItem onClick={() => props.onMerge("here")}>
                  {t("team-post.mergeHere")}
                </MenuItem>
              </MenuPopup>
            </Menu>
            <PostMenu
              workspaceId={props.workspaceId}
              postId={post.id}
              title={post.title}
              onDeleted={props.onDeleted}
            />
          </>
        ) : null
      }
    />
  );
}
