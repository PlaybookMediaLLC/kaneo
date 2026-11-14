import { useState } from "react";
import type { PortalProblem, Viewer } from "../../../core/types";
import { useGetPortalActiveSurvey } from "../../../hooks/feedback/use-get-portal-active-survey";
import { useSubmitPortalSurveyResponse } from "../../../hooks/feedback/use-submit-portal-survey-response";
import { SurveyCard } from "../../../ui/survey-card";

export interface SurveyPromptProps {
  /** Empty until the portal admits the caller. */
  workspaceId: string;
  viewer: Viewer;
}

const storageKey = (workspaceId: string) =>
  `quills-survey-dismissed:${workspaceId}`;
/** Survey IDs that the customer dismissed in this browser session. */
function dismissedIn(workspaceId: string): string[] {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(storageKey(workspaceId)) ?? "[]",
    );
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
}

/** The survey that waits for a signed-in customer, until they answer or dismiss it. */
export function SurveyPrompt({ workspaceId, viewer }: SurveyPromptProps) {
  const signedIn = viewer.kind === "user";
  const active = useGetPortalActiveSurvey(
    { param: { workspace: signedIn ? workspaceId : "" } },
    viewer,
  );
  const submit = useSubmitPortalSurveyResponse(viewer);
  // The answered survey stays for the thanks state: the refetch no longer returns it.
  const [answered, setAnswered] = useState<NonNullable<
    NonNullable<typeof active.data>["survey"]
  > | null>(null);
  const [dismissed, setDismissed] = useState(() => dismissedIn(workspaceId));
  const survey = answered ?? active.data?.survey;
  if (!signedIn || !survey || dismissed.includes(survey.id)) return null;
  return (
    <SurveyCard
      survey={survey}
      done={answered !== null}
      onDismiss={() => {
        const next = [...dismissed, survey.id];
        setDismissed(next);
        try {
          sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
        } catch {
          // Without storage the survey stays hidden until the page reloads.
        }
      }}
      onSubmit={async (json) => {
        try {
          await submit.mutateAsync({
            param: { workspace: workspaceId, surveyId: survey.id },
            json,
          });
          setAnswered(survey);
        } catch (problem) {
          return problem as PortalProblem;
        }
      }}
    />
  );
}
