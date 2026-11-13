import { useTranslation } from "react-i18next";
export interface SampleDetailProps {
  onAction?: () => void;
}
export function SampleDetail({ onAction }: SampleDetailProps) {
  const { t } = useTranslation("quills");
  return (
    <button type="button" onClick={onAction}>
      {t("sample.sample-detail")}
    </button>
  );
}
