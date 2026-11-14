import { Globe, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateComment } from "../../../hooks/team/use-create-comment";
import { useTeamRuntime } from "../../../team/runtime";
import { Composer } from "../../../ui/inbox/composer";
import { useKeyShortcuts } from "../../../ui/inbox/use-key-shortcuts";

export interface CommentBoxProps {
  workspaceId: string;
  postId: string;
  /** Set for a reply to a comment: no mode dropdown, and the reply is private when its parent is. */
  parentId?: string;
  /** The placeholder, such as "Reply to Ada…". "Write a comment…" by default. */
  label?: string;
  /** Runs after the comment is sent, for example to close a reply box. */
  onSent?: () => void;
}

/**
 * The comment composer of a request: a public comment or a private note for the team.
 * R and N focus the top-level box as a public comment or as a note.
 */
export function CommentBox(props: CommentBoxProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [text, setText] = useState("");
  const [mode, setMode] = useState("public");
  const input = useRef<HTMLTextAreaElement>(null);
  const create = useCreateComment(team.viewer);
  const allowed = team.permissions.create;
  const focus = (next: string) => () => {
    setMode(next);
    input.current?.focus();
  };
  useKeyShortcuts(
    { r: focus("public"), n: focus("private") },
    allowed && !props.parentId,
  );
  return (
    <div className="grid gap-1">
      <Composer
        label={props.label ?? t("team-post.writeComment")}
        value={text}
        onChange={setText}
        modes={
          props.parentId
            ? undefined
            : [
                { value: "public", label: t("team-post.public"), icon: Globe },
                {
                  value: "private",
                  label: t("team-post.privateNote"),
                  icon: Lock,
                  private: true,
                },
              ]
        }
        mode={mode}
        onModeChange={setMode}
        sending={create.isPending}
        disabled={!allowed}
        inputRef={input}
        onSend={() =>
          create.mutate(
            {
              param: { workspaceId: props.workspaceId, postId: props.postId },
              json: {
                content: text.trim(),
                ...(props.parentId
                  ? { parentId: props.parentId }
                  : { isPrivate: mode === "private" }),
              },
            },
            {
              onSuccess: () => {
                setText("");
                props.onSent?.();
              },
            },
          )
        }
      />
      {create.error ? (
        <p role="alert" className="px-2 text-sm text-destructive-foreground">
          {t("core.problem.failed")}
        </p>
      ) : null}
    </div>
  );
}
