import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem, PortalProblemKind } from "../core/types";
import {
  Button,
  Alert,
  AlertDescription,
  Empty,
  EmptyHeader,
  EmptyDescription,
  Spinner,
} from "./upstream";

const problemKeys: Record<PortalProblemKind, string> = {
  authRequired: "core.problem.authRequired",
  conflict: "core.problem.conflict",
  failed: "core.problem.failed",
  gone: "core.problem.gone",
  invalid: "core.problem.invalid",
  noAccess: "core.problem.noAccess",
  notFound: "core.problem.notFound",
  rateLimited: "core.problem.rateLimited",
};

export interface StateViewProps {
  loading?: boolean;
  empty?: boolean;
  problem?: PortalProblem | null;
  children: ReactNode;
  onRetry?: () => void;
}

export function StateView({
  loading,
  empty,
  problem,
  children,
  onRetry,
}: StateViewProps) {
  const { t } = useTranslation("quills");
  const [now, setNow] = useState(Date.now);
  const retryAt = problem?.kind === "rateLimited" ? problem.retryAt : undefined;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const seconds = Math.max(0, Math.ceil(((retryAt ?? now) - now) / 1000));
  if (loading)
    return (
      <div className="flex items-center gap-3 py-8" role="status">
        <Spinner />
        <p>{t("core.loading")}</p>
      </div>
    );
  if (problem)
    return (
      <Alert role="alert">
        <AlertDescription className="text-foreground">
          {t(problemKeys[problem.kind])}
        </AlertDescription>
        {onRetry &&
        (problem.kind === "failed" || problem.kind === "rateLimited") ? (
          <Button className="mt-3" disabled={seconds > 0} onClick={onRetry}>
            {seconds > 0
              ? t("core.retryAfter", { count: seconds })
              : t("core.retry")}
          </Button>
        ) : null}
      </Alert>
    );
  if (empty)
    return (
      <Empty role="status">
        <EmptyHeader>
          <EmptyDescription>{t("core.empty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return children;
}
