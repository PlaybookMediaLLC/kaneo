import { BellOff, BellRing, Eye, EyeOff, MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGetTicketWatchStatus } from "../../../hooks/team/use-get-ticket-watch-status";
import { useMuteTicket } from "../../../hooks/team/use-mute-ticket";
import { useUnmuteTicket } from "../../../hooks/team/use-unmute-ticket";
import { useUnwatchTicket } from "../../../hooks/team/use-unwatch-ticket";
import { useWatchTicket } from "../../../hooks/team/use-watch-ticket";
import { useTeamRuntime } from "../../../team/runtime";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../../ui/upstream";

export interface TicketMenuProps {
  ticketId: string;
}

// ponytail: one mute length; add a choice of 1 to 30 days when teammates ask for it.
const muteDays = 7;

/** The kebab menu of the ticket header: the caller's own watch and mute switches. */
export function TicketMenu({ ticketId }: TicketMenuProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId: team.workspaceId, ticketId };
  const own = useGetTicketWatchStatus({ param }, team.viewer);
  const changes = [
    useWatchTicket(team.viewer),
    useUnwatchTicket(team.viewer),
    useMuteTicket(team.viewer),
    useUnmuteTicket(team.viewer),
  ] as const;
  const [watch, unwatch, mute, unmute] = changes;
  const busy = changes.some((change) => change.isPending);
  const me = own.data;
  const muted = Boolean(
    me?.mutedUntil && Date.parse(me.mutedUntil) > Date.now(),
  );
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("team-tickets.more")}
            />
          }
        >
          <MoreVertical aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            disabled={!me || busy}
            onClick={() => (me?.watching ? unwatch : watch).mutate({ param })}
          >
            {me?.watching ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
            {t(me?.watching ? "team-tickets.unwatch" : "team-tickets.watch")}
          </MenuItem>
          {me?.watching ? (
            <MenuItem
              disabled={busy}
              onClick={() =>
                muted
                  ? unmute.mutate({ param })
                  : mute.mutate({ param, json: { days: muteDays } })
              }
            >
              {muted ? (
                <BellRing aria-hidden="true" />
              ) : (
                <BellOff aria-hidden="true" />
              )}
              {muted
                ? t("team-tickets.unmute")
                : t("team-tickets.mute", { count: muteDays })}
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
      {changes.some((change) => change.error) ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {t("team-tickets.failed")}
        </p>
      ) : null}
    </>
  );
}
