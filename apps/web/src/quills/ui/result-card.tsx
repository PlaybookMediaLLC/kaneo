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
    <Card
      className="portal-result mx-auto my-12 max-w-xl py-6 text-center shadow-none before:mx-auto before:mb-3 before:grid before:size-12 before:place-items-center before:rounded-full before:bg-muted before:text-2xl before:text-success-foreground before:content-['✓'] [&[data-result=failed]]:before:text-destructive [&[data-result=failed]]:before:content-['!']"
      data-result={status}
      role={status === "failed" ? "alert" : "status"}
    >
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
