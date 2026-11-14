import { useEffect, useState } from "react";
import { ApiError, type Api } from "./api.js";
import type { SurveyAnswer, WidgetSurvey } from "../ui/types.js";

const KEY = "qb-survey-dismissed";
/** Survey IDs that the visitor dismissed in this browser session. */
function dismissedIds(): string[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The survey that waits for the visitor, read once for each session after the panel opens. The
 * API gives one only to an identified visitor. A failed read shows no survey.
 */
export function useWidgetSurvey(
  api: Api,
  session: number | null,
  active: boolean,
) {
  const [found, setFound] = useState<{
    session: number;
    survey: WidgetSurvey | null;
  } | null>(null);
  const [dismissed, setDismissed] = useState(dismissedIds);
  // Answered in this session: the home tab thanks the visitor instead of asking again.
  const [answered, setAnswered] = useState<readonly string[]>([]);
  useEffect(() => {
    if (session === null || !active) return;
    const controller = new AbortController();
    api
      .request<{ survey: WidgetSurvey | null }>(
        "GET",
        "/widget/surveys/active",
        undefined,
        controller.signal,
      )
      .then((result) => setFound({ session, survey: result.survey }))
      .catch(() => {});
    return () => controller.abort();
  }, [api, session, active]);
  const survey = found?.session === session ? found.survey : null;
  return {
    survey:
      survey && !dismissed.includes(survey.id)
        ? { ...survey, answered: answered.includes(survey.id) }
        : null,
    /** An earlier answer (409) counts as answered. */
    onAnswerSurvey: async (surveyId: string, answer: SurveyAnswer) => {
      await api
        .request(
          "POST",
          `/widget/surveys/${encodeURIComponent(surveyId)}/responses`,
          answer,
        )
        .catch((error) => {
          if (!(error instanceof ApiError && error.status === 409)) throw error;
        });
      setAnswered((list) => [...list, surveyId]);
    },
    onDismissSurvey: (surveyId: string) => {
      const next = [...dismissed, surveyId];
      setDismissed(next);
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Without storage the survey stays hidden until the widget reloads.
      }
    },
  };
}
