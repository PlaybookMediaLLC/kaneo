import { useTranslation } from "react-i18next";
export interface {{NAME}}Props { onAction?: () => void; }
export function {{NAME}}({ onAction }: {{NAME}}Props) { const { t } = useTranslation("quills"); return <button type="button" onClick={onAction}>{t({{KEY}})}</button>; }
