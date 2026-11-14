import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { useCreatePost } from "../../../hooks/team/use-create-post";
import { useListTags } from "../../../hooks/team/use-list-tags";
import { useTeamRuntime } from "../../../team/runtime";
import { Dialog, DialogPopup, DialogTitle } from "../../../ui/upstream";
import { AuthorPicker, type RequestAuthor } from "./author-picker";
import { NewRequestForm } from "./new-request-form";

export interface NewRequestDialogProps {
  workspaceId: string;
  boards: ListBoardsResponse["items"];
  statuses: ListStatusesResponse["statuses"];
  /** The board of the list filter. */
  boardId?: string;
  onClose: () => void;
  /** Opens the new request. */
  onCreated: (postId: string) => void;
}

/** The New request modal. The page renders it while the address has `new=true`. */
export function NewRequestDialog(props: NewRequestDialogProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [author, setAuthor] = useState<RequestAuthor | null>(null);
  // ponytail: the first 100 tags (the API maximum); page them when a workspace has more.
  const tags = useListTags(
    { param: { workspaceId: props.workspaceId }, query: { limit: "100" } },
    team.viewer,
  );
  const create = useCreatePost(team.viewer);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="p-5 sm:max-w-2xl">
        <DialogTitle className="sr-only">
          {t("team-posts.newRequest")}
        </DialogTitle>
        <NewRequestForm
          boards={props.boards}
          statuses={props.statuses}
          tags={tags.data?.tags ?? []}
          boardId={props.boardId}
          author={
            <AuthorPicker
              workspaceId={props.workspaceId}
              value={author}
              onChange={setAuthor}
            />
          }
          onSubmit={async ({ statusId, ...values }) => {
            const post = await create.mutateAsync({
              param: { workspaceId: props.workspaceId },
              json: {
                ...values,
                ...(statusId ? { statusId } : {}),
                ...(author ? { authorPrincipalId: author.principalId } : {}),
              },
            });
            props.onCreated(post.id);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
