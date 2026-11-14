import { useTranslation } from "react-i18next";
import type { GetConversationResponse } from "../../../api/team/get-conversation";
import { useAssignConversation } from "../../../hooks/team/use-assign-conversation";
import { useBlockUser } from "../../../hooks/team/use-block-user";
import { useEndConversation } from "../../../hooks/team/use-end-conversation";
import { useGetUser } from "../../../hooks/team/use-get-user";
import { useRestoreConversationFromSpam } from "../../../hooks/team/use-restore-conversation-from-spam";
import { useSetConversationStatus } from "../../../hooks/team/use-set-conversation-status";
import { useUnblockUser } from "../../../hooks/team/use-unblock-user";
import { useTeamRuntime } from "../../../team/runtime";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { PersonAvatar } from "../../../ui/person-avatar";
import type { Teammate } from "../../team-conversations/conversation-list";
import { ActionProblem } from "./action-problem";
import { AssigneePicker } from "./assignee-picker";
import { ConversationMenu } from "./conversation-menu";
import { StatusButton } from "./status-button";

export interface ConversationHeaderProps {
  workspaceId: string;
  /** Undefined while the conversation loads: the heading still shows, so focus can land on it. */
  conversation?: GetConversationResponse;
  people: readonly Teammate[];
  myPrincipalId: string | null;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * The conversation header (design section 2): the customer on the left; the assignee pill,
 * the Resolve button and the kebab menu on the right. A spam conversation reopens through
 * the spam restore, so that it comes back to the inbox lists.
 */
export function ConversationHeader({
  workspaceId,
  conversation,
  people,
  myPrincipalId,
  ...move
}: ConversationHeaderProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const status = useSetConversationStatus(team.viewer);
  const assign = useAssignConversation(team.viewer);
  const end = useEndConversation(team.viewer);
  const restore = useRestoreConversationFromSpam(team.viewer);
  const block = useBlockUser(team.viewer);
  const unblock = useUnblockUser(team.viewer);
  const changes = [status, assign, end, restore, block, unblock];
  const sender = {
    workspaceId,
    principalId: conversation?.visitorPrincipalId ?? "",
  };
  // An anonymous visitor has no profile: the menu then offers no blocking.
  const profile = useGetUser(
    { param: { ...sender, workspaceId: conversation ? workspaceId : "" } },
    team.viewer,
  ).data;
  const param = { workspaceId, conversationId: conversation?.id ?? "" };
  const locked = !team.permissions.update || changes.some((m) => m.isPending);
  const reset = () => {
    for (const change of changes) change.reset();
  };
  const spam = conversation?.endReason === "spam";
  const name =
    conversation?.visitorName ??
    conversation?.visitorEmail ??
    t("team-conversations.unknown");
  return (
    <>
      <DetailHeader
        {...move}
        actions={
          conversation ? (
            <>
              <AssigneePicker
                value={conversation.assignedAgentPrincipalId}
                people={people}
                myPrincipalId={myPrincipalId}
                disabled={locked}
                onChange={(id) => {
                  reset();
                  assign.mutate({ param, json: { assigneePrincipalId: id } });
                }}
              />
              <StatusButton
                status={conversation.status}
                disabled={locked}
                onResolve={() => {
                  reset();
                  status.mutate({ param, json: { status: "closed" } });
                }}
                onReopen={() => {
                  reset();
                  if (spam) restore.mutate({ param });
                  else status.mutate({ param, json: { status: "open" } });
                }}
              />
              <ConversationMenu
                status={conversation.status}
                spam={spam}
                blocked={profile ? Boolean(profile.blockedAt) : null}
                disabled={locked}
                onSnooze={() => {
                  reset();
                  status.mutate({ param, json: { status: "snoozed" } });
                }}
                onSpam={() => {
                  reset();
                  end.mutate({ param, json: { reason: "spam" } });
                }}
                onNotSpam={() => {
                  reset();
                  restore.mutate({ param });
                }}
                onBlock={() => {
                  reset();
                  block.mutate({ param: sender });
                }}
                onUnblock={() => {
                  reset();
                  unblock.mutate({ param: sender });
                }}
              />
            </>
          ) : null
        }
      >
        {conversation ? (
          <PersonAvatar colored name={name} className="size-8 text-xs" />
        ) : null}
        <div className="min-w-0">
          <h1 tabIndex={-1} className="truncate font-semibold outline-none">
            {conversation ? name : t("team-conversations.conversation")}
          </h1>
          {conversation?.subject ? (
            <p className="truncate text-xs text-muted-foreground">
              {conversation.subject}
            </p>
          ) : null}
        </div>
      </DetailHeader>
      <div className="px-4 empty:hidden">
        <ActionProblem
          problem={changes.find((change) => change.error)?.error ?? null}
        />
      </div>
    </>
  );
}
