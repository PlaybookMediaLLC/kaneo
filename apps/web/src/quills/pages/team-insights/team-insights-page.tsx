import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetFeedbackInsights } from "../../hooks/team/use-get-feedback-insights";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
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
  const rangeId = useId();
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

  return (
    <PageFrame
      titleKey="insights.title"
      description={t("insights.description")}
      landmark={false}
      wide
      actions={
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={rangeId}>{t("insights.range")}</label>
          <select
            id={rangeId}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {ranges.map((count) => (
              <option key={count} value={count}>
                {t("insights.lastDays", { count })}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <TeamStateView
        loading={insights.isLoading}
        problem={insights.error ?? null}
        onRetry={() => void insights.refetch()}
      >
        {data ? (
          <div className="space-y-8">
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
                <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
                  {data.topPosts.map((post) => (
                    <li
                      key={post.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                    >
                      <span className="font-medium">{post.title}</span>
                      <span className={muted}>
                        {t("insights.newVotes", {
                          board: post.boardName,
                          count: post.newVotes,
                        })}
                      </span>
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
    </PageFrame>
  );
}
