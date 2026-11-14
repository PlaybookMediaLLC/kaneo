// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
// The answer rules and the results math of in-app surveys (RFC 0003, D8). The database only
// checks that a score is 0 to 10; these rules check the scale of each survey type.
import { HTTPException } from "hono/http-exception";
import type { SURVEY_TYPES } from "../../database/quills/schema/surveys";

export type SurveyType = (typeof SURVEY_TYPES)[number];
type Scale = { min: number; max: number };

/** The score scale of each scored type. PMF and poll take a choice; open takes a comment. */
export const SCALES: Partial<Record<SurveyType, Scale>> = {
  nps: { min: 0, max: 10 },
  csat: { min: 1, max: 5 },
  ces: { min: 1, max: 7 },
};

/** The fixed answers of a product-market fit survey. The first answer gives the score. */
export const PMF_OPTIONS = [
  "Very disappointed",
  "Somewhat disappointed",
  "Not disappointed",
];

export type Answer = { score?: number; choice?: string; comment?: string };

const invalid = (message: string) => new HTTPException(400, { message });

/** The stored values of an answer. 400 when the answer does not fit the survey type. */
export function checkAnswer(
  survey: { type: SurveyType; options: string[] },
  answer: Answer,
) {
  const comment = answer.comment?.trim() || null;
  const scale = SCALES[survey.type];
  if (scale) {
    const { score } = answer;
    if (
      score === undefined ||
      score < scale.min ||
      score > scale.max ||
      answer.choice !== undefined
    )
      throw invalid(`Give a score from ${scale.min} to ${scale.max}`);
    return { score, choice: null, comment };
  }
  if (survey.type === "open") {
    if (!comment || answer.score !== undefined || answer.choice !== undefined)
      throw invalid("Write an answer");
    return { score: null, choice: null, comment };
  }
  const { choice } = answer;
  if (
    choice === undefined ||
    !survey.options.includes(choice) ||
    answer.score !== undefined
  )
    throw invalid("Pick one of the answers");
  return { score: null, choice, comment };
}

/** Responses grouped by their score and choice. */
export type ResponseCounts = {
  score: number | null;
  choice: string | null;
  count: number;
}[];

/**
 * The results of a survey. `score` is null without responses and for poll and open surveys:
 * NPS is % promoters (9-10) minus % detractors (0-6), CSAT is % of 4-5, CES is the average
 * score, and PMF is % "Very disappointed".
 */
export function summarize(
  survey: { type: SurveyType; options: string[] },
  counts: ResponseCounts,
) {
  const sum = (list: { count: number }[]) =>
    list.reduce((total, item) => total + item.count, 0);
  const total = sum(counts);
  const scale = SCALES[survey.type];
  const scores = scale
    ? Array.from({ length: scale.max - scale.min + 1 }, (_, i) => {
        const value = scale.min + i;
        return {
          value,
          count: sum(counts.filter((row) => row.score === value)),
        };
      })
    : [];
  const choices = ["pmf", "poll"].includes(survey.type)
    ? survey.options.map((label) => ({
        label,
        count: sum(counts.filter((row) => row.choice === label)),
      }))
    : [];
  const between = (low: number, high: number) =>
    sum(scores.filter((row) => row.value >= low && row.value <= high));
  // Rounds half away from zero, so -12.5 and 12.5 round the same way.
  const percent = (part: number) => {
    const value = (100 * part) / total;
    return Math.sign(value) * Math.round(Math.abs(value)) || 0;
  };
  let score: number | null = null;
  if (total && survey.type === "nps")
    score = percent(between(9, 10) - between(0, 6));
  if (total && survey.type === "csat") score = percent(between(4, 5));
  if (total && survey.type === "ces")
    score =
      Math.round(
        (10 * scores.reduce((n, row) => n + row.value * row.count, 0)) / total,
      ) / 10;
  if (total && survey.type === "pmf") score = percent(choices[0]!.count);
  return { total, score, scores, choices };
}
