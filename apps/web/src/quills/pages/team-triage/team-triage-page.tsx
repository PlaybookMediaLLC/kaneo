import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetRevenueAtRisk } from "../../hooks/team/use-get-revenue-at-risk";
import { useListPosts } from "../../hooks/team/use-list-posts";
import { useSetPostScore } from "../../hooks/team/use-set-post-score";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { ListHeader } from "../../ui/inbox/list-header";
import { PageFrame } from "../../ui/page-frame";
import {
  Button,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
} from "../../ui/upstream";
import { TriageTable } from "./parts/triage-table";

export interface TeamTriagePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const sorts = [
  { value: "votes", labelKey: "team-triage.sortVotes" },
  { value: "mrr", labelKey: "team-triage.sortMrr" },
  { value: "rice", labelKey: "team-triage.sortRice" },
] as const;
type Sort = (typeof sorts)[number]["value"];
// The scroll area under the header. The loading, empty and error states get a margin.
const body =
  "min-h-0 flex-1 overflow-y-auto [&>[role=alert]]:m-4 [&>[role=status]]:px-4";

// Requests ranked by votes, customer revenue or RICE, with the revenue at risk.
export function TeamTriagePage({ workspaceId }: TeamTriagePageProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const [sort, setSort] = useState<Sort>("votes");
  const [editing, setEditing] = useState<string | null>(null);
  const param = { workspaceId };
  const posts = useListPosts(
    { param, query: { sort, limit: "50" } },
    team.viewer,
  );
  const risk = useGetRevenueAtRisk({ param }, team.viewer);
  const score = useSetPostScore(team.viewer);
  const money = (cents: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
      cents / 100,
    );

  return (
    <PageFrame titleKey="team-triage.title" variant="app" landmark={false}>
      <ListHeader
        title={t("team-triage.title")}
        filters={
          <MenuRadioGroup
            value={sort}
            onValueChange={(value) => setSort(value as Sort)}
          >
            <MenuGroupLabel>{t("team-triage.sort")}</MenuGroupLabel>
            {sorts.map((item) => (
              <MenuRadioItem key={item.value} value={item.value}>
                {t(item.labelKey)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        }
      />
      <div className={body}>
        <TeamStateView
          loading={posts.isLoading || risk.isLoading}
          problem={posts.error ?? risk.error ?? null}
          onRetry={() => {
            void posts.refetch();
            void risk.refetch();
          }}
        >
          <p className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("team-triage.risk")}
            </span>{" "}
            {t("team-triage.riskValue", {
              amount: money(risk.data?.mrrCents ?? 0),
              count: risk.data?.companies ?? 0,
            })}
          </p>
          <TriageTable
            posts={posts.data?.pages.flatMap((page) => page.items) ?? []}
            money={money}
            canScore={team.permissions.update}
            editingId={editing}
            onEdit={setEditing}
            onScore={async (postId, json) => {
              await score.mutateAsync({ param: { workspaceId, postId }, json });
              setEditing(null);
            }}
          />
          {posts.hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              loading={posts.isFetchingNextPage}
              onClick={() => void posts.fetchNextPage()}
            >
              {t("team-triage.loadMore")}
            </Button>
          ) : null}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
