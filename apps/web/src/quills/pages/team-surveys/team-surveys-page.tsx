import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useCreateSurvey } from "../../hooks/team/use-create-survey";
import { useListSurveys } from "../../hooks/team/use-list-surveys";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { PortalSheetContent } from "../../ui/portal-sheet-content";
import { SURVEY_STATUS_KEYS, SURVEY_TYPE_KEYS } from "../../ui/survey-labels";
import {
  Button,
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  SheetTrigger,
} from "../../ui/upstream";
import { CreateSurveyForm } from "./parts/create-survey-form";

export interface TeamSurveysPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const row =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3";
const muted = "text-sm text-muted-foreground";

// The workspace's surveys with their status and response counts, and a sheet to create a draft.
export function TeamSurveysPage({ workspaceId }: TeamSurveysPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [creating, setCreating] = useState(false);
  // ponytail: the newest 100 surveys (the API maximum); page them when a workspace has more.
  const surveys = useListSurveys(
    { param: { workspaceId }, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  const create = useCreateSurvey(team.viewer);
  const base = teamHref(workspaceId, "/surveys");
  const items = surveys.data?.surveys ?? [];

  return (
    <PageFrame
      titleKey="surveys.title"
      description={t("surveys.description")}
      landmark={false}
      wide
      actions={
        team.permissions.create ? (
          <Sheet open={creating} onOpenChange={setCreating}>
            <SheetTrigger render={<Button />}>
              {t("surveys.create.title")}
            </SheetTrigger>
            <PortalSheetContent>
              <SheetHeader>
                <SheetTitle>{t("surveys.create.title")}</SheetTitle>
              </SheetHeader>
              <SheetPanel>
                <CreateSurveyForm
                  onSubmit={async (json) => {
                    try {
                      await create.mutateAsync({
                        param: { workspaceId },
                        json,
                      });
                      setCreating(false);
                    } catch (problem) {
                      return problem as PortalProblem;
                    }
                  }}
                />
              </SheetPanel>
            </PortalSheetContent>
          </Sheet>
        ) : null
      }
    >
      <TeamStateView
        loading={surveys.isLoading}
        problem={surveys.error ?? null}
        onRetry={() => void surveys.refetch()}
      >
        {items.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((survey) => (
              <li key={survey.id} className={row}>
                <Link
                  to={`${base}/${encodeURIComponent(survey.id)}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {survey.question}
                </Link>
                <span className={muted}>
                  {t("surveys.summary", {
                    type: t(SURVEY_TYPE_KEYS[survey.type]),
                    status: t(SURVEY_STATUS_KEYS[survey.status]),
                    responses: t("surveys.responses", {
                      count: survey.responseCount,
                    }),
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={muted}>{t("surveys.none")}</p>
        )}
      </TeamStateView>
    </PageFrame>
  );
}
