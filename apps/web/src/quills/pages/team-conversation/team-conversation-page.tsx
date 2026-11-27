import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchPatch } from "../../core/use-search-patch";
import { useGetConversation } from "../../hooks/team/use-get-conversation";
import { useListConversationMessages } from "../../hooks/team/use-list-conversation-messages";
import { useListConversationViews } from "../../hooks/team/use-list-conversation-views";
import { useListConversations } from "../../hooks/team/use-list-conversations";
import { useListPrincipals } from "../../hooks/team/use-list-principals";
import { useMarkConversationRead } from "../../hooks/team/use-mark-conversation-read";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import {
  conversationHref,
  listHref,
  listQuery,
  readContext,
} from "../team-conversations/conversation-list";
import { ConversationListPane } from "../team-conversations/conversation-list-pane";
import { listTitle } from "../team-conversations/list-filters";
import { ConversationComposer } from "./parts/conversation-composer";
import { ConversationHeader } from "./parts/conversation-header";
import { emailSecurityOf } from "./email-security";
import { useKeptOpen } from "./keep-open";
import { ConversationListRows } from "./parts/conversation-list-rows";
import { ConversationProperties } from "./parts/conversation-properties";
import { MessageList } from "./parts/message-list";
import { SaveCurrentView } from "./parts/save-current-view";

export interface TeamConversationPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** One conversation (design section 2): the list it came from, the thread with its composer, and the right panel. */
export function TeamConversationPage(props: TeamConversationPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const remember = useSearchPatch();
  const { workspaceId } = props;
  const conversationId = props.params.conversationId ?? "";
  const context = readContext(props.search);
  const [saving, setSaving] = useState(false);
  const param = { workspaceId, conversationId };
  const conversation = useGetConversation({ param }, team.viewer);
  // ponytail: the newest 100 messages only; page with `before` when longer threads matter.
  const messages = useListConversationMessages(
    { param, query: { includeInternal: "true", limit: "100" } },
    team.viewer,
  );
  const views = useListConversationViews(
    { param: { workspaceId } },
    team.viewer,
  );
  const saved = views.data?.items.find((view) => view.id === context.savedView);
  const waiting = Boolean(context.savedView) && views.isLoading;
  const query = listQuery(context, saved);
  const list = useListConversations(
    { param: { workspaceId: waiting ? "" : workspaceId }, query },
    team.viewer,
  );
  const principals = useListPrincipals(
    { param: { workspaceId }, query: { limit: "100" } },
    team.viewer,
  );
  const people = principals.data?.items ?? [];
  const data = conversation.data;
  const items = useKeptOpen(list.data?.pages, conversationId, data, query);
  const { mutate: markRead } = useMarkConversationRead(team.viewer);

  // An open conversation is read: one request each time it gets unread messages.
  // The read route needs the update permission.
  const marked = useRef("");
  const unread = team.permissions.update && (data?.unreadCount ?? 0) > 0;
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
    enabled: !saving,
  });
  const customer =
    data?.visitorName ?? data?.visitorEmail ?? t("team-conversations.unknown");
  const problem = conversation.error ?? messages.error ?? null;
  const title = listTitle(context, views.data?.items ?? [], t);

  return (
    <PageFrame
      titleKey="team-conversations.conversation"
      displayTitle={data ? customer : undefined}
      variant="app"
      landmark={false}
    >
      <DetailLayout
        listLabel={title}
        list={
          <ConversationListPane
            workspaceId={workspaceId}
            context={context}
            views={views.data?.items ?? []}
            headingLevel={2}
            onSearch={(q) => remember({ q })}
            onSaveView={
              team.permissions.create ? () => setSaving(true) : undefined
            }
          >
            <ConversationListRows
              workspaceId={workspaceId}
              context={context}
              items={items}
              list={list}
              loading={waiting || list.isLoading}
              quiet={Boolean(problem)}
              people={people}
              activeId={conversationId}
              onOpen={go}
            />
          </ConversationListPane>
        }
        propertiesLabel={t("team-conversations.properties.panel")}
        properties={
          data ? (
            <ConversationProperties
              key={conversationId}
              workspaceId={workspaceId}
              conversation={data}
              emailSecurity={emailSecurityOf(messages.data?.items)}
            />
          ) : null
        }
      >
        <ConversationHeader
          workspaceId={workspaceId}
          conversation={data}
          people={people}
          myPrincipalId={
            people.find((person) => person.userId === team.viewer.id)?.id ??
            null
          }
          onBack={back}
          onPrevious={nav.previous}
          onNext={nav.next}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TeamStateView
            loading={conversation.isLoading || messages.isLoading}
            problem={problem}
            onRetry={() => {
              void conversation.refetch();
              void messages.refetch();
            }}
          >
            {data && messages.data ? (
              <MessageList
                workspaceId={workspaceId}
                conversationId={conversationId}
                closed={data.status === "closed"}
                messages={messages.data.items}
                customerName={customer}
                customerAvatarUrl={data.visitorAvatarUrl}
                people={people}
              />
            ) : null}
          </TeamStateView>
        </div>
        {data ? (
          <ConversationComposer
            key={conversationId}
            workspaceId={workspaceId}
            conversationId={conversationId}
            customerName={customer}
          />
        ) : null}
      </DetailLayout>
      <SaveCurrentView
        workspaceId={workspaceId}
        conversationId={conversationId}
        context={context}
        open={saving}
        onOpenChange={setSaving}
      />
    </PageFrame>
  );
}
