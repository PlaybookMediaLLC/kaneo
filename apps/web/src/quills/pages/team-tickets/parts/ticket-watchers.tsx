import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useGetTicketWatchStatus } from "../../../hooks/team/use-get-ticket-watch-status";
import { useListTicketWatchers } from "../../../hooks/team/use-list-ticket-watchers";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { PersonAvatar } from "../../../ui/person-avatar";

export interface TicketWatchersProps {
  ticketId: string;
}

/** The watchers of a ticket, and until when the caller muted it. The header menu changes both. */
export function TicketWatchers({ ticketId }: TicketWatchersProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const param = { workspaceId: team.workspaceId, ticketId };
  const own = useGetTicketWatchStatus({ param }, team.viewer);
  const watchers = useListTicketWatchers({ param }, team.viewer);
  const mutedUntil = own.data?.mutedUntil;
  const muted = mutedUntil && Date.parse(mutedUntil) > Date.now();

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <h2 id={heading} className="text-xs font-medium text-muted-foreground">
        {t("team-tickets.watchers")}
      </h2>
      <TeamStateView
        loading={watchers.isLoading}
        problem={watchers.error ?? null}
      >
        {watchers.data?.items.length ? null : (
          <p className="text-sm text-muted-foreground">
            {t("team-tickets.noWatchers")}
          </p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {(watchers.data?.items ?? []).map((watcher) => (
            <li key={watcher.principalId} className="flex items-center gap-2">
              <PersonAvatar
                colored
                name={watcher.displayName}
                avatarUrl={watcher.avatarUrl}
              />
              <span className="truncate">
                {watcher.displayName ?? t("team-tickets.unnamed")}
              </span>
            </li>
          ))}
        </ul>
      </TeamStateView>
      {muted ? (
        <p className="text-xs text-muted-foreground">
          {t("team-tickets.mutedUntil", {
            date: new Date(mutedUntil).toLocaleDateString(i18n.language),
          })}
        </p>
      ) : null}
    </section>
  );
}
