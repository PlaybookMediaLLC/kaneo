import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { portalHref } from "../../core/portal-href";
import { useListMyConversations } from "../../hooks/support/use-list-my-conversations";
import { useStartMyConversation } from "../../hooks/support/use-start-my-conversation";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { ResultCard } from "../../ui/result-card";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";
import { ConversationList } from "./parts/conversation-list";
import { NewConversationForm } from "./parts/new-conversation-form";

export interface SupportPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function SupportPage(props: SupportPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const workspace =
    !portal.accessLoading &&
    portal.access?.granted &&
    portal.viewer.kind === "user"
      ? props.workspaceId
      : "";
  const conversations = useListMyConversations(
    { param: { workspace }, query: { limit: "20" } },
    portal.viewer,
  );
  const start = useStartMyConversation(portal.viewer);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [createdId, setCreatedId] = useState<string | null>(null);
  const items = conversations.data?.pages.flatMap((page) => page.items) ?? [];
  const submit = async (values: {
    content: string;
    idempotencyKey: string;
  }): Promise<PortalProblem | void> => {
    try {
      const created = await start.mutateAsync({
        param: { workspace: props.workspaceId },
        json: values,
      });
      idempotencyKey.current = crypto.randomUUID();
      setCreatedId(created.conversation.id);
    } catch (error) {
      return error as PortalProblem;
    }
  };

  return (
    <PageFrame
      titleKey="support.title"
      token="none"
      tokenScope={undefined}
      persistToken
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "support")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={conversations.isLoading}
            problem={conversations.error}
            onRetry={() => void conversations.refetch()}
          >
            <a href={portalHref(props.workspaceId, "support/tickets")}>
              {t("support.tickets")}
            </a>
            {createdId ? (
              <ResultCard titleKey="support.created">
                <a
                  href={portalHref(
                    props.workspaceId,
                    `conversations/${createdId}`,
                  )}
                >
                  {t("support.openConversation", {
                    subject: t("support.subjectMissing"),
                  })}
                </a>
              </ResultCard>
            ) : (
              <>
                <h2>{t("support.newConversation")}</h2>
                <NewConversationForm
                  idempotencyKey={idempotencyKey.current}
                  onSubmit={submit}
                />
              </>
            )}
            {items.length ? (
              <ConversationList
                workspaceId={props.workspaceId}
                conversations={items}
              />
            ) : (
              <StateView empty>{null}</StateView>
            )}
            {conversations.hasNextPage ? (
              <Button
                type="button"
                loading={conversations.isFetchingNextPage}
                onClick={() => void conversations.fetchNextPage()}
              >
                {t("support.loadMore")}
              </Button>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
