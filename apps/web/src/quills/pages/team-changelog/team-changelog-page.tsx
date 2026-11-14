import { useTranslation } from "react-i18next";
import { useDraftChangelogFromPosts } from "../../hooks/team/use-draft-changelog-from-posts";
import { useListChangelogEngagement } from "../../hooks/team/use-list-changelog-engagement";
import { useSearchShippedPosts } from "../../hooks/team/use-search-shipped-posts";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import { DraftSheet } from "./parts/draft-sheet";
import { EngagementRow } from "./parts/engagement-row";

export interface TeamChangelogPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const muted = "text-sm text-muted-foreground";

/** Published updates with their readers and reactions, and AI drafts from shipped requests (RFC 0003, features 14 and 15). */
export function TeamChangelogPage({ workspaceId }: TeamChangelogPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
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

  return (
    <PageFrame
      titleKey="team-changelog.title"
      description={t("team-changelog.description")}
      landmark={false}
      wide
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
    >
      <TeamStateView
        loading={list.isLoading || shipped.isLoading}
        problem={list.error ?? shipped.error ?? null}
        onRetry={() => {
          void list.refetch();
          void shipped.refetch();
        }}
      >
        {items.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((item) => (
              <EngagementRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className={muted}>{t("core.empty")}</p>
        )}
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
    </PageFrame>
  );
}
