// Static translation keys of the survey types and statuses, so the C4 check finds each key.
export const SURVEY_TYPE_KEYS = {
  nps: "surveys.types.nps",
  csat: "surveys.types.csat",
  ces: "surveys.types.ces",
  pmf: "surveys.types.pmf",
  poll: "surveys.types.poll",
  open: "surveys.types.open",
} as const;

export const SURVEY_STATUS_KEYS = {
  draft: "surveys.status.draft",
  active: "surveys.status.active",
  closed: "surveys.status.closed",
} as const;

export type SurveyType = keyof typeof SURVEY_TYPE_KEYS;
