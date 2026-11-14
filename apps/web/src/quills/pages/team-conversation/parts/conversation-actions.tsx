import {
  AlarmClock,
  CircleCheck,
  MessageSquareReply,
  RotateCcw,
  StickyNote,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetConversationResponse } from "../../../api/team/get-conversation";
import { useAssignConversation } from "../../../hooks/team/use-assign-conversation";
import { useSetConversationStatus } from "../../../hooks/team/use-set-conversation-status";
import { useTeamRuntime } from "../../../team/runtime";
import { ActionBar } from "../../../ui/inbox/action-bar";
import { ActionProblem } from "./action-problem";

export interface ConversationActionsProps {
  workspaceId: string;
  conversation: GetConversationResponse;
  /** The caller's principal, to offer "Assign to me" or "Unassign". Null while unknown. */
  myPrincipalId: string | null;
  onCompose: (mode: "reply" | "note") => void;
}

/** The floating bar of an open conversation: Reply (R), Add note (N), snooze, close or reopen, and assign. */
export function ConversationActions({
  workspaceId,
  conversation,
  myPrincipalId,
  onCompose,
}: ConversationActionsProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const status = useSetConversationStatus(team.viewer);
  const assign = useAssignConversation(team.viewer);
  const param = { workspaceId, conversationId: conversation.id };
  const closed = conversation.status === "closed";
  const mine =
    myPrincipalId !== null &&
    conversation.assignedAgentPrincipalId === myPrincipalId;
  const setStatus = (value: "open" | "snoozed" | "closed") => {
    assign.reset();
    status.mutate({ param, json: { status: value } });
  };
  const busy = status.isPending || assign.isPending;
  const update = !team.permissions.update || busy;
  return (
    <>
      <div className="px-4">
        <ActionProblem problem={status.error ?? assign.error ?? null} />
      </div>
      <ActionBar
        label={t("team-conversations.actions")}
        actions={[
          {
            id: "reply",
            label: t("team-conversations.reply"),
            shortcut: "r",
            icon: MessageSquareReply,
            onSelect: () => onCompose("reply"),
            disabled: !team.permissions.update,
          },
          {
            id: "note",
            label: t("team-conversations.addNote"),
            shortcut: "n",
            icon: StickyNote,
            onSelect: () => onCompose("note"),
            disabled: !team.permissions.create,
          },
          {
            id: "snooze",
            label: t("team-conversations.snooze"),
            icon: AlarmClock,
            onSelect: () => setStatus("snoozed"),
            disabled: update || conversation.status !== "open",
          },
          closed
            ? {
                id: "reopen",
                label: t("team-conversations.reopen"),
                icon: RotateCcw,
                onSelect: () => setStatus("open"),
                disabled: update,
              }
            : {
                id: "close",
                label: t("team-conversations.close"),
                icon: CircleCheck,
                onSelect: () => setStatus("closed"),
                disabled: update,
              },
          {
            id: "assign",
            label: t(
              mine
                ? "team-conversations.unassign"
                : "team-conversations.assignToMe",
            ),
            icon: mine ? UserRoundX : UserRoundCheck,
            onSelect: () => {
              status.reset();
              assign.mutate({
                param,
                json: { assigneePrincipalId: mine ? null : "me" },
              });
            },
            disabled: update,
          },
        ]}
      />
    </>
  );
}
