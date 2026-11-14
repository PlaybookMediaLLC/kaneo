import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestConversationSummary } from "../../../hooks/team/use-request-conversation-summary";
import { useTeamRuntime } from "../../../team/runtime";
import { Button } from "../../../ui/upstream";

export interface SummarySectionProps {
  workspaceId: string;
  conversationId: string;
  summary: string | null;
}

/** The AI summary of the thread. A worker writes it after a request; without AI the request is refused (409). */
export function SummarySection(props: SummarySectionProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const request = useRequestConversationSummary(team.viewer);
  const kind = request.error?.kind;
  return (
    <section aria-labelledby="conversation-summary">
      <h2 id="conversation-summary" className="mb-1 text-sm font-semibold">
        {t("team-conversations.summary.title")}
      </h2>
      {props.summary ? (
        <p className="whitespace-pre-wrap text-sm">{props.summary}</p>
      ) : null}
      <p role="status" className="text-sm text-muted-foreground">
        {request.isSuccess
          ? t("team-conversations.summary.requested")
          : kind === "conflict"
            ? t("team-conversations.summary.off")
            : null}
      </p>
      {kind && kind !== "conflict" ? (
        <p role="alert" className="text-sm text-destructive">
          {t("team-conversations.problem.failed")}
        </p>
      ) : null}
      {kind === "conflict" ? null : (
        <Button
          variant="outline"
          size="sm"
          loading={request.isPending}
          disabled={!team.permissions.update || request.isSuccess}
          onClick={() =>
            request.mutate({
              param: {
                workspaceId: props.workspaceId,
                conversationId: props.conversationId,
              },
            })
          }
        >
          <Sparkles aria-hidden="true" />
          {t(
            props.summary
              ? "team-conversations.summary.refresh"
              : "team-conversations.summary.create",
          )}
        </Button>
      )}
    </section>
  );
}
