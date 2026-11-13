import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { portalHref } from "../../core/portal-href";
import { useCreateMyTicket } from "../../hooks/support/use-create-my-ticket";
import { useGetMyTickets } from "../../hooks/support/use-get-my-tickets";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { ResultCard } from "../../ui/result-card";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";
import { NewTicketForm } from "./parts/new-ticket-form";
import { TicketList } from "./parts/ticket-list";

export interface TicketsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function TicketsPage(props: TicketsPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const workspace =
    !portal.accessLoading &&
    portal.access?.granted &&
    portal.viewer.kind === "user"
      ? props.workspaceId
      : "";
  const tickets = useGetMyTickets(
    { param: { workspace }, query: { limit: "20" } },
    portal.viewer,
  );
  const create = useCreateMyTicket(portal.viewer);
  const [created, setCreated] = useState<{
    conversationId: string | null;
  } | null>(null);
  const items = tickets.data?.pages.flatMap((page) => page.items) ?? [];
  const submit = async (values: {
    title: string;
    description?: string;
  }): Promise<PortalProblem | void> => {
    try {
      const ticket = await create.mutateAsync({
        param: { workspace: props.workspaceId },
        json: values,
      });
      setCreated({ conversationId: ticket.conversationId });
    } catch (error) {
      return error as PortalProblem;
    }
  };

  return (
    <PageFrame
      titleKey="tickets.title"
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
          currentPath={portalHref(props.workspaceId, "support/tickets")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={tickets.isLoading}
            problem={tickets.error}
            onRetry={() => void tickets.refetch()}
          >
            {created ? (
              <ResultCard titleKey="tickets.created">
                {created.conversationId ? (
                  <a
                    href={portalHref(
                      props.workspaceId,
                      `conversations/${created.conversationId}`,
                    )}
                  >
                    {t("tickets.openConversation", {
                      title: t("tickets.created"),
                    })}
                  </a>
                ) : null}
              </ResultCard>
            ) : (
              <>
                <h2>{t("tickets.newTicket")}</h2>
                <NewTicketForm onSubmit={submit} />
              </>
            )}
            {items.length ? (
              <TicketList workspaceId={props.workspaceId} tickets={items} />
            ) : (
              <StateView empty>{null}</StateView>
            )}
            {tickets.hasNextPage ? (
              <Button
                type="button"
                loading={tickets.isFetchingNextPage}
                onClick={() => void tickets.fetchNextPage()}
              >
                {t("tickets.loadMore")}
              </Button>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
