import { MessageSquareReply, StickyNote } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddConversationNote } from "../../../hooks/team/use-add-conversation-note";
import { useReplyConversation } from "../../../hooks/team/use-reply-conversation";
import { useSendConversationTyping } from "../../../hooks/team/use-send-conversation-typing";
import { useTeamRuntime } from "../../../team/runtime";
import { Composer } from "../../../ui/inbox/composer";
import type { ComposerMode } from "../../../ui/inbox/inbox-types";
import { useKeyShortcuts } from "../../../ui/inbox/use-key-shortcuts";
import { ActionProblem } from "./action-problem";

export interface ConversationComposerProps {
  workspaceId: string;
  conversationId: string;
  customerName: string;
}

type Mode = "reply" | "note";

// The customer sees "typing" for a few seconds after each marker, so one marker
// every few seconds keeps it on without a request per key.
const TYPING_INTERVAL = 4000;

/**
 * The composer at the bottom of the thread: a reply to the customer or an internal note.
 * R and N choose the mode and focus the box. A reply tells the customer that it is being typed.
 */
export function ConversationComposer(props: ConversationComposerProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const reply = useReplyConversation(team.viewer);
  const note = useAddConversationNote(team.viewer);
  const typing = useSendConversationTyping(team.viewer);
  const lastTyping = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const can = { reply: team.permissions.update, note: team.permissions.create };
  const [mode, setMode] = useState<Mode>(can.reply ? "reply" : "note");
  const [text, setText] = useState("");
  const param = {
    workspaceId: props.workspaceId,
    conversationId: props.conversationId,
  };
  const focus = (next: Mode) =>
    can[next]
      ? () => {
          setMode(next);
          input.current?.focus();
        }
      : undefined;
  useKeyShortcuts({ r: focus("reply"), n: focus("note") });
  const modes: ComposerMode[] = [
    ...(can.reply
      ? [
          {
            value: "reply",
            label: t("team-conversations.reply"),
            icon: MessageSquareReply,
          },
        ]
      : []),
    ...(can.note
      ? [
          {
            value: "note",
            label: t("team-conversations.note"),
            icon: StickyNote,
            private: true,
          },
        ]
      : []),
  ];
  const sending = mode === "reply" ? reply : note;
  const send = () => {
    const request = { param, json: { content: text.trim() } };
    const options = { onSuccess: () => setText("") };
    if (mode === "reply") reply.mutate(request, options);
    else note.mutate(request, options);
  };
  return (
    <div className="mx-auto w-full max-w-205 px-4 pb-4">
      <Composer
        label={
          mode === "reply"
            ? t("team-conversations.replyTo", { name: props.customerName })
            : t("team-conversations.noteLabel")
        }
        value={text}
        onChange={(value) => {
          setText(value);
          if (mode !== "reply") return;
          if (Date.now() - lastTyping.current < TYPING_INTERVAL) return;
          lastTyping.current = Date.now();
          typing.mutate({ param });
        }}
        onSend={send}
        modes={modes}
        mode={mode}
        onModeChange={(value) => setMode(value as Mode)}
        sending={sending.isPending}
        disabled={!modes.length}
        inputRef={input}
      />
      <ActionProblem problem={sending.error} />
    </div>
  );
}
