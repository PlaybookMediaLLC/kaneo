import { useTranslation } from "react-i18next";
export interface SampleCardProps {
  onAction?: () => void;
}
export function SampleCard({ onAction }: SampleCardProps) {
  const { t } = useTranslation("quills");
  return (
    <button type="button" onClick={onAction}>
      {t("core.sample-card")}
    </button>
  );
}
