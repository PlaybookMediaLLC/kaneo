import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useGetTicketWatchStatus } from "../../../hooks/team/use-get-ticket-watch-status";
import { useListTicketWatchers } from "../../../hooks/team/use-list-ticket-watchers";
import { useMuteTicket } from "../../../hooks/team/use-mute-ticket";
import { useUnmuteTicket } from "../../../hooks/team/use-unmute-ticket";
import { useUnwatchTicket } from "../../../hooks/team/use-unwatch-ticket";
import { useWatchTicket } from "../../../hooks/team/use-watch-ticket";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { PersonAvatar } from "../../../ui/person-avatar";
import { Button } from "../../../ui/upstream";

export interface TicketWatchersProps {
  ticketId: string;
}

// ponytail: one mute length; add a choice of 1 to 30 days when teammates ask for it.
const muteDays = 7;

/** The watchers of a ticket, and the caller's own watch and mute switches. */
export function TicketWatchers({ ticketId }: TicketWatchersProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const param = { workspaceId: team.workspaceId, ticketId };
  const own = useGetTicketWatchStatus({ param }, team.viewer);
  const watchers = useListTicketWatchers({ param }, team.viewer);
  const changes = [
    useWatchTicket(team.viewer),
    useUnwatchTicket(team.viewer),
    useMuteTicket(team.viewer),
    useUnmuteTicket(team.viewer),
  ] as const;
  const [watch, unwatch, mute, unmute] = changes;
  const busy = changes.some((change) => change.isPending);
  const failed = changes.some((change) => change.error);
  const me = own.data;
  const mutedUntil =
    me?.mutedUntil && Date.parse(me.mutedUntil) > Date.now()
      ? new Date(me.mutedUntil).toLocaleDateString(i18n.language)
      : null;

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
      {me ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => (me.watching ? unwatch : watch).mutate({ param })}
          >
            {t(me.watching ? "team-tickets.unwatch" : "team-tickets.watch")}
          </Button>
          {me.watching ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                mutedUntil
                  ? unmute.mutate({ param })
                  : mute.mutate({ param, json: { days: muteDays } })
              }
            >
              {mutedUntil
                ? t("team-tickets.unmute")
                : t("team-tickets.mute", { count: muteDays })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mutedUntil ? (
        <p className="text-xs text-muted-foreground">
          {t("team-tickets.mutedUntil", { date: mutedUntil })}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {t("team-tickets.failed")}
        </p>
      ) : null}
    </section>
  );
}
