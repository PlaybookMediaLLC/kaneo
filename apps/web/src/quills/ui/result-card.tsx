import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "./upstream";

export interface ResultCardProps {
  titleKey: string;
  children?: ReactNode;
  status?: "success" | "failed";
}

export function ResultCard({
  titleKey,
  children,
  status = "success",
}: ResultCardProps) {
  const { t } = useTranslation("quills");
  return (
    <Card role={status === "failed" ? "alert" : "status"}>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
