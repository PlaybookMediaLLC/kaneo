import { ArrowUp, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { shortDate } from "../../core/short-date";
import { PersonAvatar } from "../person-avatar";
import { cn } from "../upstream";
import type { InboxBadge, InboxPerson } from "./inbox-types";
import { RowBadge } from "./row-badge";
import { useRowLink } from "./use-row-link";

export interface RequestRowProps {
  /** The item address: a modified click or a middle click opens it in a new tab. */
  href: string;
  /** Opens the item in the app. */
  onOpen: () => void;
  /** The open item or the keyboard highlight. */
  selected?: boolean;
  title: string;
  /** The leading icon, such as a PostStatusIcon. */
  icon?: ReactNode;
  /** A plain-text line under the title, for other pages, such as "12 responses". */
  detail?: string | null;
  /** Small caps badges after the title, such as "Stale 6mo". */
  badges?: readonly InboxBadge[];
  votes?: number;
  comments?: number;
  /** The board name, shown as a chip with a dot. */
  board?: string | null;
  /** An ISO time. Left out for a row without a date, such as a board. */
  time?: string;
  /** The author or the customer. */
  person?: InboxPerson | null;
  /** The stacked card of the list pane beside an open item. */
  compact?: boolean;
}

/** A request row: status icon, title, badges, votes, comments, board, date and author. */
export function RequestRow(props: RequestRowProps) {
  const { t, i18n } = useTranslation("quills");
  const link = useRowLink(props.onOpen, props.selected);
  const count = (key: string, value: number | undefined, icon: ReactNode) =>
    value === undefined ? null : (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1",
          key === "inbox.votes" &&
            "h-6 rounded-md border border-border px-1.5 text-foreground",
        )}
      >
        {icon}
        <span aria-hidden="true">{value}</span>
        <span className="sr-only">{t(key, { count: value })}</span>
      </span>
    );
  const votes = count(
    "inbox.votes",
    props.votes,
    <ArrowUp aria-hidden="true" className="size-3.5" />,
  );
  const comments = count(
    "inbox.comments",
    props.comments,
    <MessageCircle aria-hidden="true" className="size-3.5" />,
  );
  const date = props.time ? (
    <time dateTime={props.time} className="shrink-0">
      {shortDate(props.time, i18n.language)}
    </time>
  ) : null;
  const avatar = props.person ? (
    <PersonAvatar
      colored
      name={props.person.name}
      avatarUrl={props.person.avatarUrl}
    />
  ) : null;
  const detail = props.detail ? (
    <span className="block truncate text-xs text-muted-foreground">
      {props.detail}
    </span>
  ) : null;
  const badges = props.badges?.map((badge) => (
    <RowBadge key={badge.id} badge={badge} />
  ));
  const className =
    "min-w-0 rounded-lg px-3 py-2.5 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-muted";
  if (props.compact)
    return (
      <a href={props.href} {...link} className={cn("block", className)}>
        <span className="flex items-start gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 font-medium">
            {props.title}
          </span>
          {props.icon}
        </span>
        {detail}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {props.person ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {avatar}
              <span className="truncate">{props.person.name}</span>
            </span>
          ) : null}
          {badges}
          {votes}
          {comments}
          {date}
        </span>
      </a>
    );
  return (
    <a
      href={props.href}
      {...link}
      className={cn("flex items-center gap-3", className)}
    >
      {props.icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{props.title}</span>
        {detail}
      </span>
      <span className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground">
        {badges}
        {votes}
        {comments}
        {props.board ? (
          <span className="hidden max-w-32 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide sm:inline-flex">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-current"
            />
            {props.board}
          </span>
        ) : null}
        <span className="hidden sm:inline">{date}</span>
        {avatar}
        {props.person ? (
          <span className="sr-only">{props.person.name}</span>
        ) : null}
      </span>
    </a>
  );
}
