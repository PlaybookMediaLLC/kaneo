import { useTranslation } from "react-i18next";
import { Button } from "../../ui/upstream";
import { useEffect, useRef } from "react";
import { portalHref } from "../../core/portal-href";
import type { PortalProblem } from "../../core/types";
import { useGetMyConversation } from "../../hooks/support/use-get-my-conversation";
import { useListMyConversationMessages } from "../../hooks/support/use-list-my-conversation-messages";
import { useMarkMyConversationRead } from "../../hooks/support/use-mark-my-conversation-read";
import { useSendMyConversationMessage } from "../../hooks/support/use-send-my-conversation-message";
import { usePortalRuntime } from "../../portal/runtime";
import { ConversationDetail } from "../../ui/conversation/conversation-detail";
import { ConversationMessages } from "../../ui/conversation/conversation-messages";
import { ConversationReplyForm } from "../../ui/conversation/conversation-reply-form";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
export interface ConversationPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function ConversationPage(props: ConversationPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const conversationId = props.params.conversationId ?? "";
  const canLoad =
    !portal.accessLoading &&
    portal.access?.granted === true &&
    portal.viewer.kind === "user";
  const input = {
    param: {
      workspace: canLoad ? props.workspaceId : "",
      conversationId: canLoad ? conversationId : "",
    },
  };
  const conversation = useGetMyConversation(input, portal.viewer);
  const messages = useListMyConversationMessages(
    { ...input, query: { limit: "100" } },
    portal.viewer,
  );
  const send = useSendMyConversationMessage(portal.viewer);
  const {
    mutate: markAsRead,
    error: markReadError,
    reset: resetMarkRead,
  } = useMarkMyConversationRead(portal.viewer);
  const idempotencyKey = useRef(crypto.randomUUID());
  const markedThrough = useRef<string | null>(null);
  const newestMessageId = messages.data?.pages[0]?.items.at(-1)?.id;

  useEffect(() => {
    if (
      !newestMessageId ||
      !conversation.data?.conversation.unreadCount ||
      markedThrough.current === newestMessageId
    )
      return;
    markedThrough.current = newestMessageId;
    markAsRead(
      {
        param: { workspace: props.workspaceId, conversationId },
        json: { throughMessageId: newestMessageId },
      },
      {
        onError: () => {
          markedThrough.current = null;
        },
      },
    );
  }, [
    conversation.data?.conversation.unreadCount,
    conversationId,
    markAsRead,
    newestMessageId,
    props.workspaceId,
  ]);

  const sendReply = async (content: string): Promise<PortalProblem | void> => {
    try {
      await send.mutateAsync({
        param: { workspace: props.workspaceId, conversationId },
        json: { content, idempotencyKey: idempotencyKey.current },
      });
      idempotencyKey.current = crypto.randomUUID();
    } catch (error) {
      return error as PortalProblem;
    }
  };
  return (
    <PageFrame
      titleKey="conversation.title"
      token="none"
      tokenScope={undefined}
      persistToken={true}
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(
            props.workspaceId,
            `conversations/${conversationId}`,
          )}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            onRetry={() => {
              resetMarkRead();
              void conversation.refetch();
              void messages.refetch();
            }}
            loading={conversation.isLoading || messages.isLoading}
            problem={
              markReadError ?? conversation.error ?? messages.error ?? null
            }
          >
            {conversation.data && messages.data ? (
              <>
                <ConversationDetail
                  conversation={conversation.data.conversation}
                  teamTyping={conversation.data.teamTyping}
                />
                {messages.hasNextPage ? (
                  <Button
                    type="button"
                    loading={messages.isFetchingNextPage}
                    onClick={() => void messages.fetchNextPage()}
                  >
                    {t("conversation.loadOlder")}
                  </Button>
                ) : null}
                <ConversationMessages
                  messages={[...messages.data.pages]
                    .reverse()
                    .flatMap((page) => page.items)}
                />
                {conversation.data.conversation.isReadOnly ? null : (
                  <ConversationReplyForm onSubmit={sendReply} />
                )}
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
