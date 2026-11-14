import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useCreateSurvey } from "../../hooks/team/use-create-survey";
import { useListSurveys } from "../../hooks/team/use-list-surveys";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListHeader } from "../../ui/inbox/list-header";
import { RequestRow } from "../../ui/inbox/request-row";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
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

// The groups of the list, in work order.
const statuses = ["active", "draft", "closed"] as const;

// The workspace's surveys by status, and a sheet to create a draft.
export function TeamSurveysPage({ workspaceId }: TeamSurveysPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  // ponytail: the newest 100 surveys (the API maximum); page them when a workspace has more.
  const surveys = useListSurveys(
    { param: { workspaceId }, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  const create = useCreateSurvey(team.viewer);
  const items = surveys.data?.surveys ?? [];
  const groups = statuses.map((status) => ({
    id: status,
    label: t(SURVEY_STATUS_KEYS[status]),
    items: items.filter((survey) => survey.status === status),
  }));
  const href = (id: string) =>
    teamHref(workspaceId, `/surveys/${encodeURIComponent(id)}`);
  const open = (id: string) => void navigate({ to: href(id) });
  useListNavigation({
    ids: groups.flatMap((group) => group.items.map((survey) => survey.id)),
    activeId: cursor,
    onMove: setCursor,
    onOpen: open,
  });

  return (
    <PageFrame titleKey="surveys.title" variant="app" landmark={false}>
      <ListHeader
        title={t("surveys.title")}
        actions={
          team.permissions.create ? (
            <Sheet open={creating} onOpenChange={setCreating}>
              <SheetTrigger render={<Button size="sm" />}>
                <Plus aria-hidden="true" />
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
      />
      {/* The loading, empty and error states get a margin. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
        <TeamStateView
          loading={surveys.isLoading}
          problem={surveys.error ?? null}
          onRetry={() => void surveys.refetch()}
        >
          {items.length ? (
            <GroupedList
              label={t("surveys.title")}
              groups={groups}
              getKey={(survey) => survey.id}
              renderItem={(survey) => (
                <RequestRow
                  href={href(survey.id)}
                  onOpen={() => open(survey.id)}
                  selected={survey.id === cursor}
                  title={survey.question}
                  detail={t("surveys.responses", {
                    count: survey.responseCount,
                  })}
                  badges={[
                    { id: "type", label: t(SURVEY_TYPE_KEYS[survey.type]) },
                  ]}
                  time={survey.updatedAt}
                />
              )}
            />
          ) : (
            <p role="status" className="py-6 text-sm text-muted-foreground">
              {t("surveys.none")}
            </p>
          )}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
