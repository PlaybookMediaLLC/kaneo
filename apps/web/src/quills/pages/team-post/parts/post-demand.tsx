import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useGetPostDemand } from "../../../hooks/team/use-get-post-demand";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { PropertyRow } from "../../../ui/inbox/property-row";

export interface PostDemandProps {
  workspaceId: string;
  postId: string;
}

/** Who asks for a post: companies, their revenue, segments and the importance of the votes. */
export function PostDemand({ workspaceId, postId }: PostDemandProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const demand = useGetPostDemand(
    { param: { workspaceId, postId } },
    team.viewer,
  );
  const data = demand.data;
  const money = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 0,
  });
  return (
    <section aria-labelledby={heading} className="py-2">
      <h3 id={heading} className="text-sm font-medium">
        {t("team-post.demand")}
      </h3>
      <TeamStateView
        loading={demand.isLoading}
        problem={demand.error}
        onRetry={() => void demand.refetch()}
      >
        {data ? (
          <>
            <PropertyRow label={t("team-post.companies")}>
              {data.companies}
            </PropertyRow>
            <PropertyRow label={t("team-post.mrr")}>
              {money.format(data.mrrCents / 100)}
            </PropertyRow>
            <PropertyRow label={t("team-post.importance")}>
              {t("team-post.importanceCounts", data.importance)}
            </PropertyRow>
            <PropertyRow label={t("team-post.segments")}>
              {data.segments.length
                ? data.segments
                    .map((segment) =>
                      t("team-post.segmentVoters", {
                        name: segment.name,
                        count: segment.voters,
                      }),
                    )
                    .join(", ")
                : t("team-post.noSegments")}
            </PropertyRow>
          </>
        ) : null}
      </TeamStateView>
    </section>
  );
}
