import { useTranslation } from "react-i18next";
import { shortDate } from "../../core/short-date";
import { PersonAvatar } from "../person-avatar";
import { cn } from "../upstream";
import type { InboxBadge, InboxPerson } from "./inbox-types";
import { RowBadge } from "./row-badge";
import { useRowLink } from "./use-row-link";

export interface ConversationRowProps {
  /** The item address: a modified click or a middle click opens it in a new tab. */
  href: string;
  /** Opens the item in the app. */
  onOpen: () => void;
  /** The open item or the keyboard highlight. */
  selected?: boolean;
  /** The customer, or the requester of a ticket. */
  person: InboxPerson;
  /** A subject or a ticket title, before the preview. */
  title?: string | null;
  /** The plain-text preview line. Pass Markdown through `plainText` first. */
  preview?: string | null;
  /** An ISO time, such as the last message. */
  time: string;
  /** The teammate in charge, as a mini avatar. */
  assignee?: InboxPerson | null;
  /** A status badge at the end of the preview line, such as "Resolved". */
  badge?: InboxBadge | null;
  unread?: boolean;
}

/** A conversation or ticket row: avatar, name, date, preview, assignee and status badge. */
export function ConversationRow(props: ConversationRowProps) {
  const { t, i18n } = useTranslation("quills");
  const link = useRowLink(props.onOpen, props.selected);
  return (
    <a
      href={props.href}
      {...link}
      className="flex min-w-0 gap-3 rounded-lg px-3 py-2.5 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-muted"
    >
      <PersonAvatar
        colored
        name={props.person.name}
        avatarUrl={props.person.avatarUrl}
        className="size-9 text-xs"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              props.unread ? "font-semibold" : "font-medium",
            )}
          >
            {props.person.name}
          </span>
          {props.unread ? (
            <span className="sr-only">{t("inbox.unread")}</span>
          ) : null}
          <time
            dateTime={props.time}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {shortDate(props.time, i18n.language)}
          </time>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {props.title ? (
              <span className="text-foreground">{props.title} </span>
            ) : null}
            {props.preview}
          </span>
          {props.assignee ? (
            <span className="flex shrink-0">
              <PersonAvatar
                colored
                name={props.assignee.name}
                avatarUrl={props.assignee.avatarUrl}
                className="size-4 text-[8px]"
              />
              <span className="sr-only">
                {t("inbox.assignedTo", { name: props.assignee.name ?? "" })}
              </span>
            </span>
          ) : null}
          {props.badge ? <RowBadge badge={props.badge} /> : null}
        </span>
      </span>
    </a>
  );
}
