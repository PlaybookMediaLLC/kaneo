import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem, PortalProblemKind } from "../core/types";
import { Button } from "./upstream";

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
  if (loading) return <p role="status">{t("core.loading")}</p>;
  if (problem)
    return (
      <div>
        <p role="alert">{t(problemKeys[problem.kind])}</p>
        {onRetry &&
        (problem.kind === "failed" || problem.kind === "rateLimited") ? (
          <Button disabled={seconds > 0} onClick={onRetry}>
            {seconds > 0
              ? t("core.retryAfter", { count: seconds })
              : t("core.retry")}
          </Button>
        ) : null}
      </div>
    );
  if (empty) return <p role="status">{t("core.empty")}</p>;
  return children;
}
