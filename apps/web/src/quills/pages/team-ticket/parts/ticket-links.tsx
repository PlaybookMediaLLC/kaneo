import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useGetTicketLinks } from "../../../hooks/team/use-get-ticket-links";
import { useListTicketConversations } from "../../../hooks/team/use-list-ticket-conversations";
import { useListTicketExternalLinks } from "../../../hooks/team/use-list-ticket-external-links";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { teamHref } from "../../../team/team-href";

export interface TicketLinksProps {
  ticketId: string;
}

const link = "text-sm underline-offset-4 hover:underline";
// A stored issue address is shown as a link only when it is a web address.
const isWeb = (url: string | null): url is string =>
  Boolean(url && /^https?:\/\//i.test(url));

/** The conversations, the tracker tickets and the external issues of a ticket. Read only. */
export function TicketLinks({ ticketId }: TicketLinksProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const { workspaceId, viewer } = team;
  const param = { workspaceId, ticketId };
  const conversations = useListTicketConversations({ param }, viewer);
  const trackers = useGetTicketLinks({ param }, viewer);
  const issues = useListTicketExternalLinks({ param }, viewer);
  const pair = conversations.data?.pairConversationId;
  const sources = (conversations.data?.provenanceConversationIds ?? []).filter(
    (id) => id !== pair,
  );
  const tickets = [
    ...(trackers.data?.tracker ? [trackers.data.tracker] : []),
    ...(trackers.data?.linked ?? []),
  ];
  const external = issues.data?.links ?? [];
  const conversation = (id: string) =>
    teamHref(workspaceId, `/conversations/${encodeURIComponent(id)}`);
  const empty = !pair && !sources.length && !tickets.length && !external.length;

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <h2 id={heading} className="text-xs font-medium text-muted-foreground">
        {t("team-tickets.links")}
      </h2>
      <TeamStateView
        loading={
          conversations.isLoading || trackers.isLoading || issues.isLoading
        }
        problem={conversations.error ?? trackers.error ?? issues.error ?? null}
      >
        {empty ? (
          <p className="text-sm text-muted-foreground">
            {t("team-tickets.noLinks")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pair ? (
              <li>
                <Link className={link} to={conversation(pair)}>
                  {t("team-tickets.customerConversation")}
                </Link>
              </li>
            ) : null}
            {sources.map((id, index) => (
              <li key={id}>
                <Link className={link} to={conversation(id)}>
                  {t("team-tickets.sourceConversation", { number: index + 1 })}
                </Link>
              </li>
            ))}
            {tickets.map((item) => (
              <li key={item.id}>
                <Link
                  className={link}
                  to={teamHref(
                    workspaceId,
                    `/tickets/${encodeURIComponent(item.id)}`,
                  )}
                >
                  {t("team-tickets.linkedTicket", {
                    reference: item.reference,
                    title: item.title,
                  })}
                </Link>
              </li>
            ))}
            {external.map((issue) => {
              const label = t("team-tickets.issue", {
                provider: issue.integrationType,
                id: issue.externalDisplayId ?? issue.externalId,
              });
              return (
                <li key={issue.id} className="text-sm">
                  {isWeb(issue.externalUrl) ? (
                    <a
                      className={link}
                      href={issue.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TeamStateView>
    </section>
  );
}
