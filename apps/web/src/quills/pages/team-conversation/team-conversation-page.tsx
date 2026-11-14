import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetConversation } from "../../hooks/team/use-get-conversation";
import { useListConversationMessages } from "../../hooks/team/use-list-conversation-messages";
import { useListConversationViews } from "../../hooks/team/use-list-conversation-views";
import { useListConversations } from "../../hooks/team/use-list-conversations";
import { useListPrincipals } from "../../hooks/team/use-list-principals";
import { useMarkConversationRead } from "../../hooks/team/use-mark-conversation-read";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { DetailHeader } from "../../ui/inbox/detail-header";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import {
  conversationHref,
  listHref,
  listQuery,
  readContext,
  viewTitleKeys,
} from "../team-conversations/conversation-list";
import { ConversationActions } from "./parts/conversation-actions";
import { ConversationComposer } from "./parts/conversation-composer";
import { ConversationHeader } from "./parts/conversation-header";
import { ConversationListPane } from "./parts/conversation-list-pane";
import { ConversationProperties } from "./parts/conversation-properties";
import { MessageList } from "./parts/message-list";

export interface TeamConversationPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** One conversation in three panes: the list it came from, the thread with its composer, and its properties. */
export function TeamConversationPage(props: TeamConversationPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const { workspaceId } = props;
  const conversationId = props.params.conversationId ?? "";
  const context = readContext(props.search);
  const param = { workspaceId, conversationId };
  const conversation = useGetConversation({ param }, team.viewer);
  // ponytail: the newest 100 messages only; page with `before` when longer threads matter.
  const messages = useListConversationMessages(
    { param, query: { includeInternal: "true", limit: "100" } },
    team.viewer,
  );
  const views = useListConversationViews(
    { param: { workspaceId: context.savedView ? workspaceId : "" } },
    team.viewer,
  );
  const saved = views.data?.items.find((view) => view.id === context.savedView);
  const list = useListConversations(
    {
      param: {
        workspaceId: context.savedView && views.isLoading ? "" : workspaceId,
      },
      query: listQuery(context, saved),
    },
    team.viewer,
  );
  const principals = useListPrincipals(
    { param: { workspaceId }, query: { limit: "100" } },
    team.viewer,
  );
  const { mutate: markRead } = useMarkConversationRead(team.viewer);
  const [composer, setComposer] = useState<{
    id: string;
    mode: "reply" | "note";
  }>();
  const mode = composer?.id === conversationId ? composer.mode : null;
  const people = principals.data?.items ?? [];
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const data = conversation.data;

  // An open conversation is read: one request each time it gets unread messages.
  const marked = useRef("");
  const unread = (data?.unreadCount ?? 0) > 0;
  useEffect(() => {
    if (!unread) marked.current = "";
    if (!unread || marked.current === conversationId) return;
    marked.current = conversationId;
    markRead({ param: { workspaceId, conversationId } });
  }, [unread, conversationId, workspaceId, markRead]);

  const go = (id: string) =>
    void navigate({ href: conversationHref(workspaceId, id, context) });
  const back = () => void navigate({ href: listHref(workspaceId, context) });
  const nav = useListNavigation({
    ids: items.map((item) => item.id),
    activeId: conversationId,
    onMove: go,
    onBack: back,
  });
  const customer =
    data?.visitorName ?? data?.visitorEmail ?? t("team-conversations.unknown");

  return (
    <PageFrame
      titleKey="team-conversations.conversation"
      displayTitle={data?.subject ?? undefined}
      variant="app"
      landmark={false}
    >
      <DetailLayout
        listLabel={t(viewTitleKeys[context.view])}
        list={
          <ConversationListPane
            workspaceId={workspaceId}
            context={context}
            items={items}
            people={people}
            activeId={conversationId}
            onOpen={go}
            loading={list.isLoading}
          />
        }
        propertiesLabel={t("team-conversations.properties.title")}
        properties={
          data ? (
            <ConversationProperties
              workspaceId={workspaceId}
              conversation={data}
              people={people}
            />
          ) : null
        }
      >
        <DetailHeader
          onBack={back}
          onPrevious={nav.previous}
          onNext={nav.next}
        />
        <ConversationHeader
          workspaceId={workspaceId}
          conversation={data}
          people={people}
        />
        <div className="flex-1 px-4 py-4">
          <TeamStateView
            loading={conversation.isLoading || messages.isLoading}
            problem={conversation.error ?? messages.error ?? null}
            onRetry={() => {
              void conversation.refetch();
              void messages.refetch();
            }}
          >
            {data && messages.data ? (
              <MessageList
                workspaceId={workspaceId}
                conversationId={conversationId}
                messages={messages.data.items}
                customerName={customer}
              />
            ) : null}
          </TeamStateView>
        </div>
        {data && mode ? (
          <ConversationComposer
            workspaceId={workspaceId}
            conversationId={conversationId}
            mode={mode}
            onClose={() => setComposer(undefined)}
          />
        ) : null}
        {data ? (
          <ConversationActions
            workspaceId={workspaceId}
            conversation={data}
            myPrincipalId={
              people.find((person) => person.userId === team.viewer.id)?.id ??
              null
            }
            onCompose={(next) =>
              setComposer({ id: conversationId, mode: next })
            }
          />
        ) : null}
      </DetailLayout>
    </PageFrame>
  );
}
