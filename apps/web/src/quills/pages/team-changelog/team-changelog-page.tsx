import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useDraftChangelogFromPosts } from "../../hooks/team/use-draft-changelog-from-posts";
import { useListChangelogEngagement } from "../../hooks/team/use-list-changelog-engagement";
import { useSearchShippedPosts } from "../../hooks/team/use-search-shipped-posts";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { ListHeader } from "../../ui/inbox/list-header";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import { DraftSheet } from "./parts/draft-sheet";
import { EngagementRow } from "./parts/engagement-row";

export interface TeamChangelogPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** Published updates with their readers and reactions, and AI drafts from shipped requests (RFC 0003, features 14 and 15). */
export function TeamChangelogPage({ workspaceId }: TeamChangelogPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const list = useListChangelogEngagement(
    { param: { workspaceId }, query: {} },
    team.viewer,
  );
  // ponytail: the 20 shipped posts with the most votes; add a search field when teams need older ones.
  const shipped = useSearchShippedPosts(
    { param: { workspaceId }, query: {} },
    team.viewer,
  );
  const draft = useDraftChangelogFromPosts(team.viewer);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  // A row opens the update as customers see it on the portal.
  const href = (id: string) =>
    portalHref(workspaceId, `changelog/${encodeURIComponent(id)}`);

  return (
    <PageFrame titleKey="team-changelog.title" variant="app" landmark={false}>
      <ListHeader
        title={t("team-changelog.title")}
        actions={
          shipped.data ? (
            <DraftSheet
              posts={shipped.data.posts}
              draft={draft.data ?? null}
              problem={draft.error ?? null}
              onDraft={async (postIds) => {
                await draft.mutateAsync({
                  param: { workspaceId },
                  json: { postIds },
                });
              }}
            />
          ) : null
        }
      />
      {/* The loading, empty and error states get a margin. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
        <TeamStateView
          loading={list.isLoading || shipped.isLoading}
          problem={list.error ?? shipped.error ?? null}
          empty={!items.length}
          onRetry={() => {
            void list.refetch();
            void shipped.refetch();
          }}
        >
          <ul aria-label={t("team-changelog.title")} className="grid gap-0.5">
            {items.map((item) => (
              <li key={item.id}>
                <EngagementRow
                  item={item}
                  href={href(item.id)}
                  onOpen={() => void navigate({ to: href(item.id) })}
                />
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => list.fetchNextPage()}
              loading={list.isFetchingNextPage}
            >
              {t("team-changelog.loadMore")}
            </Button>
          ) : null}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
