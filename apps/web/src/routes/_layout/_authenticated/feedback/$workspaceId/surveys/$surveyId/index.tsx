import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamSurveyPage } from "@/quills/pages/team-survey/team-survey-page";
const searchSchema = z.object({});
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/surveys/$surveyId/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamSurveyPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
