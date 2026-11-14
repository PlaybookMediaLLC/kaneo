import { useTranslation } from "react-i18next";

export interface SurveyBarsProps {
  rows: { label: string; count: number }[];
  total: number;
}

/** One bar for each score or answer. The count is also text, so the bar is not the only cue. */
export function SurveyBars({ rows, total }: SurveyBarsProps) {
  const { t } = useTranslation("quills");
  return (
    <ul className="mt-3 grid gap-2">
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(4rem,12rem)_1fr_3rem] items-center gap-3 text-sm"
        >
          <span className="truncate">{row.label}</span>
          <meter
            className="h-2 w-full"
            min={0}
            max={Math.max(total, 1)}
            value={row.count}
            aria-label={t("surveys.results.bar", {
              label: row.label,
              count: row.count,
              total,
            })}
          />
          <span className="text-right tabular-nums text-muted-foreground">
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}
