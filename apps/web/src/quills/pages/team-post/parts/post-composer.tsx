import { MessageSquareReply, StickyNote } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateComment } from "../../../hooks/team/use-create-comment";
import { useTeamRuntime } from "../../../team/runtime";
import { FloatingActionBar } from "../../../ui/inbox/floating-action-bar";
import { CommentForm, type CommentFormProps } from "./comment-form";

export interface PostComposerProps {
  workspaceId: string;
  postId: string;
}

/** The action bar of a post: Reply (R) and Add note (N) open the composer. */
export function PostComposer({ workspaceId, postId }: PostComposerProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [mode, setMode] = useState<CommentFormProps["mode"] | null>(null);
  const create = useCreateComment(team.viewer);
  if (mode)
    return (
      <div className="sticky bottom-0 border-t border-border bg-background py-3">
        <CommentForm
          key={mode}
          mode={mode}
          onCancel={() => setMode(null)}
          onSubmit={async ({ content }) => {
            await create.mutateAsync({
              param: { workspaceId, postId },
              json: { content, isPrivate: mode === "note" },
            });
            setMode(null);
          }}
        />
      </div>
    );
  return (
    <FloatingActionBar
      label={t("team-post.actions")}
      actions={[
        {
          id: "reply",
          label: t("team-post.reply"),
          shortcut: "r",
          icon: MessageSquareReply,
          onSelect: () => setMode("reply"),
          disabled: !team.permissions.create,
        },
        {
          id: "note",
          label: t("team-post.addNote"),
          shortcut: "n",
          icon: StickyNote,
          onSelect: () => setMode("note"),
          disabled: !team.permissions.create,
        },
      ]}
    />
  );
}
