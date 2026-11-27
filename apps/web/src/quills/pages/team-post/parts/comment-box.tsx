import { Globe, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateComment } from "../../../hooks/team/use-create-comment";
import { useTeamRuntime } from "../../../team/runtime";
import { Composer } from "../../../ui/inbox/composer";
import { EmojiMenu } from "../../../ui/inbox/emoji-menu";
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
  const canPublic = team.permissions.create;
  const canPrivate = Boolean(
    team.permissions.create || team.permissions.commentInternal,
  );
  const [text, setText] = useState("");
  const [mode, setMode] = useState(canPublic ? "public" : "private");
  const input = useRef<HTMLTextAreaElement>(null);
  const create = useCreateComment(team.viewer);
  const allowed = canPublic || canPrivate;
  const focus = (next: string) => () => {
    if (next === "public" && !canPublic) return;
    if (next === "private" && !canPrivate) return;
    setMode(next);
    input.current?.focus();
  };
  useKeyShortcuts(
    { r: focus("public"), n: focus("private") },
    allowed && !props.parentId,
  );
  // Puts the emoji at the cursor, or in place of the selected text.
  const insert = (emoji: string) => {
    const box = input.current;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? start;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  const modes = props.parentId
    ? undefined
    : [
        ...(canPublic
          ? [{ value: "public", label: t("team-post.public"), icon: Globe }]
          : []),
        ...(canPrivate
          ? [
              {
                value: "private",
                label: t("team-post.privateNote"),
                icon: Lock,
                private: true,
              },
            ]
          : []),
      ];
  return (
    <div className="grid grid-cols-1 gap-1">
      <Composer
        label={props.label ?? t("team-post.writeComment")}
        value={text}
        onChange={setText}
        modes={modes}
        mode={canPublic ? mode : "private"}
        onModeChange={setMode}
        tools={<EmojiMenu onPick={insert} disabled={!allowed} />}
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
                  : { isPrivate: !canPublic || mode === "private" }),
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
