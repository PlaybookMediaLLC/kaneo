import { useTranslation } from "react-i18next";
import type { GetFeedbackInsightsResponse } from "../../../api/team/get-feedback-insights";

export interface WeeklyTrendProps {
  weeks: GetFeedbackInsightsResponse["weeks"];
}

const cell = "px-3 py-2 text-right tabular-nums";

/** New posts and votes per week, as a table. */
export function WeeklyTrend({ weeks }: WeeklyTrendProps) {
  const { t } = useTranslation("quills");
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-base font-semibold">
        {t("insights.trend")}
      </caption>
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <th scope="col" className="px-3 py-2 text-left font-medium">
            {t("insights.week")}
          </th>
          <th scope="col" className={`${cell} font-medium`}>
            {t("insights.posts")}
          </th>
          <th scope="col" className={`${cell} font-medium`}>
            {t("insights.votes")}
          </th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.week} className="border-b border-border">
            <th scope="row" className="px-3 py-2 text-left font-normal">
              {week.week}
            </th>
            <td className={cell}>{week.posts}</td>
            <td className={cell}>{week.votes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
