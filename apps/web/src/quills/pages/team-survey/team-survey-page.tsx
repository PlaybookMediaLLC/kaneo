import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useDeleteSurvey } from "../../hooks/team/use-delete-survey";
import { useGetSurveyResults } from "../../hooks/team/use-get-survey-results";
import { useSetSurveyStatus } from "../../hooks/team/use-set-survey-status";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { ConfirmAction } from "../../ui/confirm-action";
import { PageFrame } from "../../ui/page-frame";
import { ResultCard } from "../../ui/result-card";
import { SURVEY_STATUS_KEYS, SURVEY_TYPE_KEYS } from "../../ui/survey-labels";
import { SurveyBars } from "./parts/survey-bars";

export interface TeamSurveyPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const SCORE_KEYS = {
  nps: "surveys.results.score.nps",
  csat: "surveys.results.score.csat",
  ces: "surveys.results.score.ces",
  pmf: "surveys.results.score.pmf",
} as const;
const heading = "text-base font-semibold";
const muted = "text-sm text-muted-foreground";

// One survey: its results with simple bars, the latest comments, and the next status action.
export function TeamSurveyPage({ workspaceId, params }: TeamSurveyPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId, surveyId: params.surveyId ?? "" };
  const results = useGetSurveyResults({ param }, team.viewer);
  const status = useSetSurveyStatus(team.viewer);
  const remove = useDeleteSurvey(team.viewer);
  const list = `/dashboard/workspace/${encodeURIComponent(workspaceId)}/quills/surveys`;
  const back = (
    <Link to={list} className={`${muted} underline-offset-4 hover:underline`}>
      {t("surveys.actions.list")}
    </Link>
  );
  const data = results.data;
  const survey = data?.survey;
  const scoreKey =
    survey && survey.type in SCORE_KEYS
      ? SCORE_KEYS[survey.type as keyof typeof SCORE_KEYS]
      : null;
  const rows = data
    ? [
        ...data.scores.map((s) => ({ label: String(s.value), count: s.count })),
        ...data.choices,
      ]
    : [];
  const move = (next: "active" | "closed") => () =>
    status.mutateAsync({ param, json: { status: next } }).then(() => undefined);

  return (
    <PageFrame
      titleKey="surveys.title"
      displayTitle={remove.isSuccess ? undefined : survey?.question}
      eyebrow={back}
      landmark={false}
      wide
      description={
        survey && !remove.isSuccess
          ? t("surveys.summary", {
              type: t(SURVEY_TYPE_KEYS[survey.type]),
              status: t(SURVEY_STATUS_KEYS[survey.status]),
              responses: t("surveys.responses", { count: data.total }),
            })
          : undefined
      }
      actions={
        survey && !remove.isSuccess ? (
          <>
            {survey.status === "draft" && team.permissions.update ? (
              <ConfirmAction
                labelKey="surveys.actions.activate"
                onConfirm={move("active")}
              />
            ) : null}
            {survey.status === "active" && team.permissions.update ? (
              <ConfirmAction
                labelKey="surveys.actions.close"
                onConfirm={move("closed")}
              />
            ) : null}
            {survey.status === "draft" && team.permissions.delete ? (
              <ConfirmAction
                labelKey="surveys.actions.delete"
                onConfirm={() =>
                  remove.mutateAsync({ param }).then(() => undefined)
                }
              />
            ) : null}
          </>
        ) : null
      }
    >
      {remove.isSuccess ? (
        <ResultCard titleKey="surveys.actions.deleted">{back}</ResultCard>
      ) : (
        <TeamStateView
          loading={results.isLoading}
          problem={results.error ?? null}
          onRetry={() => void results.refetch()}
        >
          {data && survey ? (
            <>
              {scoreKey ? (
                <p className="text-2xl font-semibold">
                  {data.score === null
                    ? t("surveys.results.noScore")
                    : t(scoreKey, { score: data.score })}
                </p>
              ) : null}
              {rows.length ? (
                <section aria-labelledby="team-survey-answers">
                  <h2 id="team-survey-answers" className={heading}>
                    {t("surveys.results.answers")}
                  </h2>
                  <SurveyBars rows={rows} total={data.total} />
                </section>
              ) : null}
              <section aria-labelledby="team-survey-comments">
                <h2 id="team-survey-comments" className={heading}>
                  {t("surveys.results.comments")}
                </h2>
                {data.comments.length ? (
                  <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {data.comments.map((comment) => (
                      <li key={comment.id} className="px-4 py-3">
                        <p>{comment.comment}</p>
                        <p className={muted}>
                          {comment.respondent ?? t("surveys.results.person")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`mt-2 ${muted}`}>
                    {t("surveys.results.noComments")}
                  </p>
                )}
              </section>
            </>
          ) : null}
        </TeamStateView>
      )}
    </PageFrame>
  );
}
