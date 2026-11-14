import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { useGetAssistantRun } from "../../../hooks/team/use-get-assistant-run";
import { useGetTicketSummary } from "../../../hooks/team/use-get-ticket-summary";
import { useRequestTicketSummary } from "../../../hooks/team/use-request-ticket-summary";
import { useSuggestTicketFieldValues } from "../../../hooks/team/use-suggest-ticket-field-values";
import { useTeamRuntime } from "../../../team/runtime";
import { Button } from "../../../ui/upstream";

export interface TicketAiProps {
  ticket: GetTicketResponse;
}

/**
 * The AI summary and the field suggestions of a ticket. A worker writes both after the
 * request; its change event refreshes this panel. The API answers 409 when AI is off.
 */
export function TicketAi({ ticket }: TicketAiProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const { workspaceId, viewer } = team;
  const param = { workspaceId, ticketId: ticket.id };
  const summary = useGetTicketSummary({ param }, viewer);
  const summarize = useRequestTicketSummary(viewer);
  const suggest = useSuggestTicketFieldValues(viewer);
  const run = useGetAssistantRun(
    { param: { workspaceId, runId: suggest.data?.id ?? "" } },
    viewer,
  );
  const result = run.data ?? suggest.data;
  const off = (problem: { kind: string } | null) =>
    problem?.kind === "conflict";

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <h2 id={heading} className="text-xs font-medium text-muted-foreground">
        {t("team-tickets.ai.title")}
      </h2>
      <p className="whitespace-pre-wrap text-sm">
        {summary.data?.summary ?? t("team-tickets.ai.noSummary")}
      </p>
      <div className="flex flex-wrap gap-2">
        {team.permissions.update ? (
          <Button
            size="sm"
            variant="outline"
            loading={summarize.isPending}
            onClick={() => summarize.mutate({ param })}
          >
            {t("team-tickets.ai.summarize")}
          </Button>
        ) : null}
        {ticket.ticketType ? (
          <Button
            size="sm"
            variant="outline"
            loading={suggest.isPending}
            onClick={() => suggest.mutate({ param })}
          >
            {t("team-tickets.ai.suggest")}
          </Button>
        ) : null}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {summarize.isSuccess ? t("team-tickets.ai.requested") : null}
        {result?.status === "pending" ? t("team-tickets.ai.working") : null}
      </p>
      {result?.status === "succeeded" ? (
        <dl className="grid gap-1 text-sm">
          {(result.output?.values ?? []).map((value) => (
            <div key={value.key}>
              <dt className="text-muted-foreground">{value.key}</dt>
              <dd>
                {String(value.value ?? t("team-tickets.ai.noValue"))}
                {value.reason ? (
                  <span className="block text-xs text-muted-foreground">
                    {value.reason}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {off(summarize.error) || off(suggest.error) ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t(
            off(summarize.error)
              ? "team-tickets.ai.off"
              : "team-tickets.ai.noFields",
          )}
        </p>
      ) : summarize.error ||
        suggest.error ||
        summary.error ||
        result?.status === "failed" ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {t("team-tickets.ai.failed")}
        </p>
      ) : null}
    </section>
  );
}
