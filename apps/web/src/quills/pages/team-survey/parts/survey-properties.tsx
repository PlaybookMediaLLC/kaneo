import { useTranslation } from "react-i18next";
import type { GetSurveyResultsResponse } from "../../../api/team/get-survey-results";
import { relativeTime } from "../../../core/relative-time";
import { PropertyRow } from "../../../ui/inbox/property-row";
import {
  SURVEY_STATUS_KEYS,
  SURVEY_TYPE_KEYS,
} from "../../../ui/survey-labels";

export interface SurveyPropertiesProps {
  survey: GetSurveyResultsResponse["survey"];
  /** The number of responses in the results. */
  total: number;
}

/** The properties panel of a survey: its type, status, responses and last change. */
export function SurveyProperties({ survey, total }: SurveyPropertiesProps) {
  const { t, i18n } = useTranslation("quills");
  return (
    <div>
      <PropertyRow label={t("surveys.create.type")}>
        {t(SURVEY_TYPE_KEYS[survey.type])}
      </PropertyRow>
      <PropertyRow label={t("surveys.properties.status")}>
        {t(SURVEY_STATUS_KEYS[survey.status])}
      </PropertyRow>
      <PropertyRow label={t("surveys.properties.responses")}>
        {t("surveys.responses", { count: total })}
      </PropertyRow>
      <PropertyRow label={t("surveys.properties.updated")}>
        <time dateTime={survey.updatedAt}>
          {relativeTime(survey.updatedAt, i18n.language)}
        </time>
      </PropertyRow>
    </div>
  );
}
