import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchPatch } from "../../core/use-search-patch";
import { useListConversationViews } from "../../hooks/team/use-list-conversation-views";
import { useListConversations } from "../../hooks/team/use-list-conversations";
import { useListPrincipals } from "../../hooks/team/use-list-principals";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { EmptySelection } from "../../ui/inbox/empty-selection";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import {
  conversationHref,
  listHref,
  listQuery,
  readContext,
} from "./conversation-list";
import { ConversationListPane } from "./conversation-list-pane";
import { ConversationRows } from "./conversation-rows";
import { listTitle } from "./list-filters";
import { NewMessage } from "./parts/new-message";
import { SaveViewDialog } from "./parts/save-view-dialog";

export interface TeamConversationsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/**
 * The support inbox (design section 2): the list pane of a view, filter or saved view, and
 * an empty main pane or a new message. `next` opens the first row, as the Queue pill does.
 */
export function TeamConversationsPage(props: TeamConversationsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const remember = useSearchPatch();
  const { workspaceId } = props;
  const context = readContext(props.search, props.params.view);
  // The router reads "?new=true" as true.
  const composing = props.search.new === true;
  const [active, setActive] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const param = { workspaceId };
  const views = useListConversationViews({ param }, team.viewer);
  const saved = views.data?.items.find((view) => view.id === context.savedView);
  // A saved view in the address waits for its rules, so the list loads once.
  const waiting = Boolean(context.savedView) && views.isLoading;
  const list = useListConversations(
    {
      param: { workspaceId: waiting ? "" : workspaceId },
      query: listQuery(context, saved),
    },
    team.viewer,
  );
  const principals = useListPrincipals(
    { param, query: { limit: "100" } },
    team.viewer,
  );
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const href = (id: string) => conversationHref(workspaceId, id, context);
  const open = (id: string) => void navigate({ href: href(id) });
  useListNavigation({
    ids: items.map((item) => item.id),
    activeId: active,
    onMove: setActive,
    onOpen: open,
    enabled: !composing && !saving,
  });
  const next =
    props.search.next === true && !waiting && !list.isLoading
      ? items[0]
        ? href(items[0].id)
        : listHref(workspaceId, context)
      : null;
  useEffect(() => {
    if (next) void navigate({ href: next, replace: true });
  }, [next, navigate]);
  const title = listTitle(context, views.data?.items ?? [], t);

  return (
    <PageFrame
      titleKey="team-conversations.title"
      displayTitle={title}
      variant="app"
      landmark={false}
    >
      <DetailLayout
        listLabel={title}
        itemOpen={composing}
        list={
          <ConversationListPane
            workspaceId={workspaceId}
            context={context}
            views={views.data?.items ?? []}
            headingLevel={1}
            onSearch={(q) => remember({ q })}
            onSaveView={() => setSaving(true)}
          >
            <TeamStateView
              loading={waiting || list.isLoading}
              problem={list.error ?? views.error ?? null}
              empty={!items.length}
              onRetry={() => {
                void views.refetch();
                void list.refetch();
              }}
            >
              <ConversationRows
                workspaceId={workspaceId}
                context={context}
                items={items}
                people={principals.data?.items ?? []}
                activeId={active}
                onOpen={open}
                more={
                  list.hasNextPage
                    ? {
                        loading: list.isFetchingNextPage,
                        load: () => void list.fetchNextPage(),
                      }
                    : undefined
                }
              />
            </TeamStateView>
          </ConversationListPane>
        }
      >
        {composing ? (
          <NewMessage
            workspaceId={workspaceId}
            onClose={() => remember({ new: undefined })}
            onStarted={open}
          />
        ) : (
          <EmptySelection
            icon={MessagesSquare}
            title={t("team-conversations.empty.title")}
            text={t("team-conversations.empty.text")}
          />
        )}
      </DetailLayout>
      <SaveViewDialog
        workspaceId={workspaceId}
        context={context}
        open={saving}
        onOpenChange={setSaving}
        onSaved={(id) => {
          setSaving(false);
          void navigate({
            href: listHref(workspaceId, { ...context, savedView: id }),
          });
        }}
      />
    </PageFrame>
  );
}
