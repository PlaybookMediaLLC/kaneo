import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { GetConversationResponse } from "../../../api/team/get-conversation";
import { apiOrigin } from "../../../core/api-origin";
import { useArchiveConversation } from "../../../hooks/team/use-archive-conversation";
import { useAssignConversation } from "../../../hooks/team/use-assign-conversation";
import { useBlockConversationIp } from "../../../hooks/team/use-block-conversation-ip";
import { useBlockUser } from "../../../hooks/team/use-block-user";
import { useGetConversationIpBlock } from "../../../hooks/team/use-get-conversation-ip-block";
import { useUnblockConversationIp } from "../../../hooks/team/use-unblock-conversation-ip";
import { useEndConversation } from "../../../hooks/team/use-end-conversation";
import { useGetUser } from "../../../hooks/team/use-get-user";
import { useRestoreConversationFromSpam } from "../../../hooks/team/use-restore-conversation-from-spam";
import { useSetConversationStatus } from "../../../hooks/team/use-set-conversation-status";
import { useUnarchiveConversation } from "../../../hooks/team/use-unarchive-conversation";
import { useUnblockUser } from "../../../hooks/team/use-unblock-user";
import type { ThreadViewer } from "../../../hooks/team/use-thread-presence";
import { useTeamRuntime } from "../../../team/runtime";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { ThreadViewersAvatars } from "../../../ui/inbox/thread-viewers-avatars";
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
  viewers?: readonly ThreadViewer[];
  myPrincipalId: string | null;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** The conversation header (design section 2): the customer, the assignee pill, Resolve and the
 * kebab menu. A spam conversation reopens through the spam restore, back into the inbox lists. */
export function ConversationHeader({
  workspaceId,
  conversation,
  people,
  viewers,
  myPrincipalId,
  ...move
}: ConversationHeaderProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const queryClient = useQueryClient();
  const status = useSetConversationStatus(team.viewer);
  const assign = useAssignConversation(team.viewer);
  const end = useEndConversation(team.viewer);
  const restore = useRestoreConversationFromSpam(team.viewer);
  const block = useBlockUser(team.viewer);
  const unblock = useUnblockUser(team.viewer);
  const blockIp = useBlockConversationIp(team.viewer);
  const unblockIp = useUnblockConversationIp(team.viewer);
  const archive = useArchiveConversation(team.viewer);
  const unarchive = useUnarchiveConversation(team.viewer);
  const offerSolution = useMutation({
    mutationFn: async () => {
      if (!conversation) return;
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversation.id)}/offer-solution`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) throw new Error(`Offer solution failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quills"] });
    },
  });
  const changes = [
    status,
    assign,
    end,
    restore,
    block,
    unblock,
    blockIp,
    unblockIp,
    archive,
    unarchive,
  ];
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
  // The sender's address, kept 90 days, can be blocked for 30 days (an anonymous visitor too).
  const ip = useGetConversationIpBlock(
    { param: { ...param, workspaceId: conversation ? workspaceId : "" } },
    team.viewer,
  ).data;
  const locked =
    !team.permissions.update ||
    changes.some((m) => m.isPending) ||
    offerSolution.isPending;
  const reset = () => {
    for (const change of changes) change.reset();
    offerSolution.reset();
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
              {viewers?.length ? (
                <ThreadViewersAvatars viewers={viewers} />
              ) : null}
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
                archived={Boolean(conversation.archivedAt)}
                blocked={profile ? Boolean(profile.blockedAt) : null}
                ipBlocked={ip?.available ? Boolean(ip.blockedUntil) : null}
                disabled={locked}
                onOfferSolution={() => {
                  reset();
                  offerSolution.mutate();
                }}
                onSnooze={() => {
                  reset();
                  status.mutate({ param, json: { status: "snoozed" } });
                }}
                onUnsnooze={() => {
                  reset();
                  status.mutate({ param, json: { status: "open" } });
                }}
                onSpam={() => {
                  reset();
                  end.mutate({ param, json: { reason: "spam" } });
                }}
                onNotSpam={() => {
                  reset();
                  restore.mutate({ param });
                }}
                onArchive={() => {
                  reset();
                  archive.mutate({ param });
                }}
                onUnarchive={() => {
                  reset();
                  unarchive.mutate({ param });
                }}
                onBlock={() => {
                  reset();
                  block.mutate({ param: sender });
                }}
                onUnblock={() => {
                  reset();
                  unblock.mutate({ param: sender });
                }}
                onBlockIp={() => {
                  reset();
                  blockIp.mutate({ param });
                }}
                onUnblockIp={() => {
                  reset();
                  unblockIp.mutate({ param });
                }}
              />
            </>
          ) : null
        }
      >
        {conversation ? (
          <PersonAvatar
            colored
            name={name}
            avatarUrl={conversation.visitorAvatarUrl}
            className="size-8 text-xs"
          />
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
        {offerSolution.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {t("core.problem.failed")}
          </p>
        ) : null}
      </div>
    </>
  );
}
