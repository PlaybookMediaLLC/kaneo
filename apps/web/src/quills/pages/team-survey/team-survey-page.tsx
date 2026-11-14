import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useDeleteSurvey } from "../../hooks/team/use-delete-survey";
import { useGetSurveyResults } from "../../hooks/team/use-get-survey-results";
import { useListSurveys } from "../../hooks/team/use-list-surveys";
import { useSetSurveyStatus } from "../../hooks/team/use-set-survey-status";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { DetailHeader } from "../../ui/inbox/detail-header";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { ListPane } from "../../ui/inbox/list-pane";
import { RequestRow } from "../../ui/inbox/request-row";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { ResultCard } from "../../ui/result-card";
import { SurveyActions } from "./parts/survey-actions";
import { SurveyProperties } from "./parts/survey-properties";
import { SurveyResults } from "./parts/survey-results";

export interface TeamSurveyPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

// One survey in three panes: the other surveys, its results with the status actions, and its properties.
export function TeamSurveyPage({ workspaceId, params }: TeamSurveyPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<PortalProblem | null>(null);
  const surveyId = params.surveyId ?? "";
  const param = { workspaceId, surveyId };
  const results = useGetSurveyResults({ param }, team.viewer);
  // ponytail: the newest 100 surveys (the API maximum), as on the list page.
  const surveys = useListSurveys(
    { param: { workspaceId }, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  const status = useSetSurveyStatus(team.viewer);
  const remove = useDeleteSurvey(team.viewer);
  const list = teamHref(workspaceId, "/surveys");
  const href = (id: string) => `${list}/${encodeURIComponent(id)}`;
  const items = surveys.data?.surveys ?? [];
  const survey = remove.isSuccess ? undefined : results.data?.survey;
  const run = (action: () => Promise<unknown>) => {
    setProblem(null);
    action().catch((error: PortalProblem) => setProblem(error));
  };
  const move = (next: "active" | "closed") => () =>
    run(() => status.mutateAsync({ param, json: { status: next } }));
  const back = () => void navigate({ to: list });
  const nav = useListNavigation({
    ids: items.map((item) => item.id),
    activeId: surveyId,
    onMove: (id) => void navigate({ to: href(id) }),
    onBack: back,
  });

  return (
    <PageFrame
      titleKey="surveys.title"
      displayTitle={survey?.question}
      variant="app"
      landmark={false}
    >
      <DetailLayout
        list={
          <ListPane
            title={t("surveys.title")}
            headingLevel={2}
            loading={surveys.isLoading}
          >
            <ul className="grid gap-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <RequestRow
                    href={href(item.id)}
                    onOpen={() => void navigate({ to: href(item.id) })}
                    selected={item.id === surveyId}
                    title={item.question}
                    detail={t("surveys.responses", {
                      count: item.responseCount,
                    })}
                    time={item.updatedAt}
                    compact
                  />
                </li>
              ))}
            </ul>
          </ListPane>
        }
        listLabel={t("surveys.title")}
        properties={
          survey && results.data ? (
            <SurveyProperties survey={survey} total={results.data.total} />
          ) : null
        }
        propertiesLabel={t("surveys.properties.title")}
      >
        <DetailHeader onBack={back} onPrevious={nav.previous} onNext={nav.next}>
          <h1
            tabIndex={-1}
            className="line-clamp-2 min-w-0 text-lg font-semibold leading-tight outline-none"
          >
            {survey?.question ?? t("surveys.properties.survey")}
          </h1>
        </DetailHeader>
        <div className="mx-auto grid w-full max-w-3xl gap-6 px-6 py-5">
          {remove.isSuccess ? (
            <ResultCard titleKey="surveys.actions.deleted">
              <Link
                to={list}
                className="text-sm underline-offset-4 hover:underline"
              >
                {t("surveys.actions.list")}
              </Link>
            </ResultCard>
          ) : (
            <TeamStateView
              loading={results.isLoading}
              problem={results.error ?? null}
              onRetry={() => void results.refetch()}
            >
              {results.data ? <SurveyResults results={results.data} /> : null}
            </TeamStateView>
          )}
          <TeamStateView problem={problem}>{null}</TeamStateView>
        </div>
        <div className="grow" />
        {survey ? (
          <SurveyActions
            status={survey.status}
            canUpdate={team.permissions.update}
            canDelete={team.permissions.delete}
            busy={status.isPending || remove.isPending}
            onActivate={move("active")}
            onClose={move("closed")}
            onDelete={() => run(() => remove.mutateAsync({ param }))}
          />
        ) : null}
      </DetailLayout>
    </PageFrame>
  );
}
