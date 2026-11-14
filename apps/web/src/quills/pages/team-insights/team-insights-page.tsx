import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetFeedbackInsights } from "../../hooks/team/use-get-feedback-insights";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { ListHeader } from "../../ui/inbox/list-header";
import { RequestRow } from "../../ui/inbox/request-row";
import { PageFrame } from "../../ui/page-frame";
import {
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
} from "../../ui/upstream";
import { MeterList } from "./parts/meter-list";
import { WeeklyTrend } from "./parts/weekly-trend";

export interface TeamInsightsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const DAY = 86_400_000;
const ranges = [7, 30, 90, 180];
const moods = {
  positive: "insights.positive",
  neutral: "insights.neutral",
  negative: "insights.negative",
} as const;
const muted = "text-sm text-muted-foreground";

/** Tags, sentiment and the weekly trend of the posts on the boards that the teammate can see. */
export function TeamInsightsPage({ workspaceId }: TeamInsightsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  // Whole UTC days up to today, as the API counts them.
  const from = new Date(Date.now() - (days - 1) * DAY)
    .toISOString()
    .slice(0, 10);
  const insights = useGetFeedbackInsights(
    { param: { workspaceId }, query: { from } },
    team.viewer,
  );
  const data = insights.data;
  const post = (id: string) =>
    teamHref(workspaceId, `/posts/${encodeURIComponent(id)}`);

  return (
    <PageFrame titleKey="insights.title" variant="app" landmark={false}>
      <ListHeader
        title={t("insights.title")}
        filters={
          <MenuRadioGroup
            value={days}
            onValueChange={(value) => setDays(Number(value))}
          >
            <MenuGroupLabel>{t("insights.range")}</MenuGroupLabel>
            {ranges.map((count) => (
              <MenuRadioItem key={count} value={count}>
                {t("insights.lastDays", { count })}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <TeamStateView
          loading={insights.isLoading}
          problem={insights.error ?? null}
          onRetry={() => void insights.refetch()}
        >
          {data ? (
            <div className="mx-auto max-w-4xl space-y-8">
              <p className={muted}>
                {t("insights.period", { from: data.from, to: data.to })}
              </p>
              <MeterList
                titleKey="insights.topics"
                emptyKey="insights.noTopics"
                max={Math.max(0, ...data.tags.map((tag) => tag.count))}
                items={data.tags.map((tag) => ({
                  id: tag.id,
                  label: tag.name,
                  value: tag.count,
                }))}
              />
              <MeterList
                titleKey="insights.sentiment"
                emptyKey="insights.noSentiment"
                max={Object.values(data.sentiment).reduce((a, b) => a + b, 0)}
                items={(Object.keys(moods) as (keyof typeof moods)[]).map(
                  (mood) => ({
                    id: mood,
                    label: t(moods[mood]),
                    value: data.sentiment[mood],
                  }),
                )}
              />
              <WeeklyTrend weeks={data.weeks} />
              <section aria-labelledby="team-insights-top">
                <h2 id="team-insights-top" className="text-base font-semibold">
                  {t("insights.topPosts")}
                </h2>
                {data.topPosts.length ? (
                  <ol className="-mx-3 mt-2 grid gap-0.5">
                    {data.topPosts.map((item) => (
                      <li key={item.id}>
                        <RequestRow
                          href={post(item.id)}
                          onOpen={() => void navigate({ to: post(item.id) })}
                          title={item.title}
                          detail={t("insights.newVotes", {
                            board: item.boardName,
                            count: item.newVotes,
                          })}
                        />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={`mt-2 ${muted}`}>{t("insights.noTopPosts")}</p>
                )}
              </section>
            </div>
          ) : null}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
