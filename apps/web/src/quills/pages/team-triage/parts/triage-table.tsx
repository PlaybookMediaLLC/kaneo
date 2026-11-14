import { useTranslation } from "react-i18next";
import type { TriagePost } from "../../../api/team/triage-post.type";
import type { PortalProblem } from "../../../core/types";
import { Button } from "../../../ui/upstream";
import { ScoreForm, type ScoreValues } from "./score-form";

export interface TriageTableProps {
  posts: TriagePost[];
  /** Formats a sum in cents. */
  money: (cents: number) => string;
  canScore: boolean;
  editingId: string | null;
  onEdit: (postId: string | null) => void;
  onScore: (
    postId: string,
    values: ScoreValues,
  ) => Promise<PortalProblem | void>;
}

const cell = "px-3 py-2 text-right tabular-nums";
const head = "px-3 py-2 text-right font-medium whitespace-nowrap";

/** Requests with their demand and RICE score, and an inline score editor. */
export function TriageTable(props: TriageTableProps) {
  const { t, i18n } = useTranslation("quills");
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  });
  if (!props.posts.length)
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {t("team-triage.none")}
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 ps-4 pe-3 text-left font-medium">
              {t("team-triage.post")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.votes")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.nice")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.important")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.critical")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.companies")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.mrr")}
            </th>
            <th scope="col" className={head}>
              {t("team-triage.rice")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {props.posts.flatMap((post) => {
            const editing = props.editingId === post.id;
            const { rice, ...score } = post.score;
            // The visible value starts the button's name (WCAG 2.5.3).
            const riceText =
              rice === null ? t("team-triage.unset") : number.format(rice);
            const row = (
              <tr key={post.id}>
                <th
                  scope="row"
                  className="py-2 ps-4 pe-3 text-left font-medium"
                >
                  {post.title}
                </th>
                <td className={cell}>{post.voteCount}</td>
                <td className={cell}>{post.demand.importance.nice}</td>
                <td className={cell}>{post.demand.importance.important}</td>
                <td className={cell}>{post.demand.importance.critical}</td>
                <td className={cell}>{post.demand.companies}</td>
                <td className={cell}>{props.money(post.demand.mrrCents)}</td>
                <td className={cell}>
                  {props.canScore ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={editing}
                      aria-label={t("team-triage.editScore", {
                        value: riceText,
                        title: post.title,
                      })}
                      onClick={() => props.onEdit(editing ? null : post.id)}
                    >
                      {riceText}
                    </Button>
                  ) : (
                    riceText
                  )}
                </td>
              </tr>
            );
            return editing
              ? [
                  row,
                  <tr key={`${post.id}-score`}>
                    <td colSpan={8} className="bg-muted/30 px-3">
                      <ScoreForm
                        score={score as ScoreValues}
                        onSubmit={(values) => props.onScore(post.id, values)}
                      />
                    </td>
                  </tr>,
                ]
              : [row];
          })}
        </tbody>
      </table>
    </div>
  );
}
