import { useRef } from "react";
import type { PortalProblem } from "../../../core/types";
import { useAddConversationNote } from "../../../hooks/team/use-add-conversation-note";
import { useReplyConversation } from "../../../hooks/team/use-reply-conversation";
import { useSendConversationTyping } from "../../../hooks/team/use-send-conversation-typing";
import { useTeamRuntime } from "../../../team/runtime";
import { ComposerForm } from "./composer-form";

export interface ConversationComposerProps {
  workspaceId: string;
  conversationId: string;
  mode: "reply" | "note";
  /** Runs after a send and on cancel. */
  onClose: () => void;
}

// The customer sees "typing" for a few seconds after each marker, so one marker
// every few seconds keeps it on without a request per key.
const TYPING_INTERVAL = 4000;

/** Sends a reply to the customer or saves an internal note, and tells the customer that a reply is being typed. */
export function ConversationComposer(props: ConversationComposerProps) {
  const team = useTeamRuntime();
  const reply = useReplyConversation(team.viewer);
  const note = useAddConversationNote(team.viewer);
  const typing = useSendConversationTyping(team.viewer);
  const lastTyping = useRef(0);
  const param = {
    workspaceId: props.workspaceId,
    conversationId: props.conversationId,
  };
  const send = async (content: string): Promise<PortalProblem | void> => {
    try {
      await (props.mode === "reply" ? reply : note).mutateAsync({
        param,
        json: { content },
      });
      props.onClose();
    } catch (error) {
      return error as PortalProblem;
    }
  };
  return (
    <div className="border-t border-border px-4 py-3">
      <ComposerForm
        key={props.mode}
        mode={props.mode}
        onSubmit={send}
        onCancel={props.onClose}
        onTyping={
          props.mode === "reply"
            ? () => {
                if (Date.now() - lastTyping.current < TYPING_INTERVAL) return;
                lastTyping.current = Date.now();
                typing.mutate({ param });
              }
            : undefined
        }
      />
    </div>
  );
}
