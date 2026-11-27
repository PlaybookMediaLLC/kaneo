import { useEffect, useState } from "react";
import type { Api } from "./api.js";
import type { WidgetPerson } from "../ui/types.js";

export type TeamPresence = {
  online: boolean;
  withinOfficeHours: boolean;
  nextOpenAt?: string | null;
  estimatedWaitMinutes?: number | null;
  estimatedWaitRange?: {
    minMinutes: number;
    maxMinutes: number;
    label: string;
  } | null;
};

/**
 * The team's availability, rolling wait-time estimate (#333), and up to four teammate avatars,
 * read when the panel opens and refreshed every 60s while open. Both routes are public reads;
 * a failure shows the default contact text.
 */
export function useWidgetTeam(
  api: Api,
  active: boolean,
  onPresence: (presence: TeamPresence) => void,
) {
  const [team, setTeam] = useState<{
    online: boolean;
    avatars: WidgetPerson[];
    withinOfficeHours?: boolean;
    waitEstimateLabel?: string | null;
    nextOpenAt?: string | null;
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      Promise.all([
        api.request<{
          agentsOnline: boolean;
          withinOfficeHours: boolean;
          nextOpenAt?: string | null;
          estimatedWaitMinutes?: number | null;
          estimatedWaitRange?: {
            minMinutes: number;
            maxMinutes: number;
            label: string;
          } | null;
        }>("GET", "/widget/presence", undefined, signal),
        api
          .request<{
            items: Array<{ name: string; avatarUrl: string | null }>;
          }>("GET", "/widget/team-avatars", undefined, signal)
          .catch(() => ({ items: [] })),
      ])
        .then(([presence, { items }]) => {
          setTeam({
            online: presence.agentsOnline,
            withinOfficeHours: presence.withinOfficeHours,
            waitEstimateLabel: presence.estimatedWaitRange?.label ?? null,
            nextOpenAt: presence.nextOpenAt ?? null,
            avatars: items.slice(0, 4).map((item) => ({
              name: item.name,
              ...(item.avatarUrl && { avatarUrl: item.avatarUrl }),
            })),
          });
          onPresence({
            online: presence.agentsOnline,
            withinOfficeHours: presence.withinOfficeHours,
            nextOpenAt: presence.nextOpenAt ?? null,
            estimatedWaitMinutes: presence.estimatedWaitMinutes ?? null,
            estimatedWaitRange: presence.estimatedWaitRange ?? null,
          });
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
    // onPresence posts to the SDK; a new function each render must not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, active]);
  return team ? { team } : {};
}
