import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { plainText } from "../core/plain-text";
import { shortDate } from "../core/short-date";
import { useGetNotificationUnreadCount } from "../hooks/team/use-get-notification-unread-count";
import { useListNotifications } from "../hooks/team/use-list-notifications";
import { useMarkAllNotificationsRead } from "../hooks/team/use-mark-all-notifications-read";
import { useMarkNotificationRead } from "../hooks/team/use-mark-notification-read";
import {
  Button,
  cn,
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/upstream";
import { desktopAllowed } from "./desktop-choice";
import { useTeamRuntime } from "./runtime";
import { teamHref } from "./team-href";
import { TeamStateView } from "./team-state-view";

export interface NotificationsButtonProps {
  workspaceId: string;
  /** Runs after a notification is opened, for example to close the sheet. */
  onNavigate?: () => void;
}

/** The bell: the caller's Quills notifications, newest first, with an unread dot. */
export function NotificationsButton({
  workspaceId,
  onNavigate,
}: NotificationsButtonProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const [open, setOpen] = useState(false);
  const param = { workspaceId };
  const unread = useGetNotificationUnreadCount({ param }, team.viewer);
  const list = useListNotifications(
    { param: { workspaceId: open ? workspaceId : "" }, query: { limit: "20" } },
    team.viewer,
  );
  const readAll = useMarkAllNotificationsRead(team.viewer);
  const readOne = useMarkNotificationRead(team.viewer);
  const count = unread.data?.count ?? 0;
  const items = list.data?.notifications ?? [];

  // A new notification while the app is in the background shows on the desktop when allowed.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (unread.data === undefined) return;
    const before = seen.current;
    seen.current = count;
    if (
      before !== null &&
      count > before &&
      document.hidden &&
      desktopAllowed()
    )
      new Notification(t("team.notifications.new", { count: count - before }));
  }, [count, unread.data, t]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="relative" />}
        aria-label={
          count
            ? t("team.notifications.unread", { count })
            : t("team.notifications.title")
        }
      >
        <Bell aria-hidden="true" />
        {count ? (
          <span
            aria-hidden="true"
            className="absolute end-1 top-1 size-2 rounded-full bg-priority-high"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80">
        <div className="mb-2 flex items-center justify-between gap-2">
          <PopoverTitle className="text-sm">
            {t("team.notifications.title")}
          </PopoverTitle>
          {count ? (
            <Button
              variant="ghost"
              size="xs"
              loading={readAll.isPending}
              onClick={() => readAll.mutate({ param })}
            >
              {t("team.notifications.readAll")}
            </Button>
          ) : null}
        </div>
        <TeamStateView
          loading={list.isLoading}
          problem={list.error ?? readAll.error ?? null}
          empty={!items.length}
        >
          <ul className="-mx-2 grid max-h-96 gap-0.5 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={teamHref(
                    workspaceId,
                    item.postId
                      ? `/posts/${encodeURIComponent(item.postId)}`
                      : "",
                  )}
                  onClick={() => {
                    if (!item.readAt)
                      readOne.mutate({
                        param: { workspaceId, notificationId: item.id },
                      });
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className="grid gap-0.5 rounded-lg px-2 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "flex items-center gap-2",
                      !item.readAt && "font-medium",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    {item.readAt ? null : (
                      <span className="sr-only">{t("inbox.unread")}</span>
                    )}
                    <time
                      dateTime={item.createdAt}
                      className="shrink-0 text-xs font-normal text-muted-foreground"
                    >
                      {shortDate(item.createdAt, i18n.language)}
                    </time>
                  </span>
                  {item.body ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {plainText(item.body)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </TeamStateView>
      </PopoverPopup>
    </Popover>
  );
}
