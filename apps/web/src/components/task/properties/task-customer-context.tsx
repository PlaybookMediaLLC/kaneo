import { useQuery } from "@tanstack/react-query";
import { Building2, MessageSquare, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getTaskCustomerContext } from "@/fetchers/task/get-task-customer-context";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

type TaskCustomerContextProps = {
  workspaceId: string;
  taskId: string;
};

function formatMonthlyMrr(cents: number): string {
  if (cents < 100) return "<$1/mo";
  return `$${Math.round(cents / 100).toLocaleString()}/mo`;
}

export function TaskCustomerContext({
  workspaceId,
  taskId,
}: TaskCustomerContextProps) {
  const { t } = useTranslation();
  const { canReadQuills } = useWorkspacePermission();
  const canRead = canReadQuills();
  const { data } = useQuery({
    queryKey: ["task", "customer-context", workspaceId, taskId],
    queryFn: () => getTaskCustomerContext(workspaceId, taskId),
    enabled: Boolean(workspaceId && taskId && canRead),
    staleTime: 60_000,
    retry: false,
  });

  if (!data || data.summary.totalLinkedPosts === 0) return null;

  const visibleCompanies = data.companies.slice(0, 6);
  const remainingCompanies = Math.max(
    0,
    data.companies.length - visibleCompanies.length,
  );

  return (
    <section
      aria-label={t("tasks:properties.customerContext")}
      className="flex flex-col gap-2 border-t border-border/60 pt-3"
    >
      <div className="flex items-center justify-between px-2">
        <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {t("tasks:properties.customerContext")}
        </span>
        {data.summary.totalMrrCents !== null &&
          data.summary.totalMrrCents > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-[11px] text-foreground">
              {formatMonthlyMrr(data.summary.totalMrrCents)}
            </span>
          )}
      </div>

      <div className="flex flex-wrap gap-3 px-2 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {t("tasks:properties.votesCount", { count: data.summary.totalVotes })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden="true" />
          {t("tasks:properties.requestersCount", {
            count: data.summary.uniqueRequesters,
          })}
        </span>
        {data.summary.uniqueCompanies > 0 && (
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3.5" aria-hidden="true" />
            {t("tasks:properties.companiesCount", {
              count: data.summary.uniqueCompanies,
            })}
          </span>
        )}
      </div>

      {visibleCompanies.length > 0 && (
        <ul className="flex flex-wrap gap-1 px-2">
          {visibleCompanies.map((company) => (
            <li
              key={company.id}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs text-foreground"
            >
              <span className="max-w-32 truncate">{company.name}</span>
              {company.churnRisk && (
                <>
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-destructive"
                    title={t("tasks:properties.churnRisk")}
                  />
                  <span className="sr-only">
                    {t("tasks:properties.churnRisk")}
                  </span>
                </>
              )}
            </li>
          ))}
          {remainingCompanies > 0 && (
            <li className="inline-flex items-center rounded-md border border-border/60 bg-muted/20 px-2 py-0.5 text-muted-foreground text-xs">
              +{remainingCompanies}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
