import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";

export interface ActionProblemProps {
  /** The error of the last change, or null. */
  problem: PortalProblem | null;
}

const keys: Partial<Record<PortalProblem["kind"], string>> = {
  conflict: "team-conversations.problem.conflict",
  noAccess: "team-conversations.problem.noAccess",
  rateLimited: "team-conversations.problem.rateLimited",
};

/** Says why a change to the conversation failed. A 409 usually means required fields are empty. */
export function ActionProblem({ problem }: ActionProblemProps) {
  const { t } = useTranslation("quills");
  if (!problem) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t(keys[problem.kind] ?? "team-conversations.problem.failed")}
    </p>
  );
}
