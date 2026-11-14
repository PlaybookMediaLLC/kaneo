import { UserRound } from "lucide-react";
import { type MouseEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../../core/relative-time";
import { PersonAvatar } from "../person-avatar";
import { cn } from "../upstream";

export interface ListRowProps {
  /** The item address: a modified click or a middle click opens it in a new tab. */
  href: string;
  /** Opens the item in the app. */
  onOpen: () => void;
  /** The keyboard highlight of a list, or the open item of the compact list. */
  selected?: boolean;
  /** The customer or author. */
  person: InboxPerson;
  /** A short reference such as "T-39". */
  shortId?: string;
  title: string;
  preview?: string | null;
  chips?: readonly { id: string; label: string }[];
  /** An ISO time, such as the last activity. */
  time: string;
  /** Null shows the unassigned icon; undefined shows nothing. */
  assignee?: InboxPerson | null;
  unread?: boolean;
  /** The stacked card of the detail view list. */
  compact?: boolean;
}

/** One inbox item: avatar, name, short ID, title, preview, chips, time and assignee. */
export function ListRow(props: ListRowProps) {
  const { t, i18n } = useTranslation("quills");
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (props.selected) link.current?.scrollIntoView?.({ block: "nearest" });
  }, [props.selected]);
  const open = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    props.onOpen();
  };
  const chips = props.chips?.length ? (
    <span className="flex shrink-0 flex-wrap gap-1">
      {props.chips.map((chip) => (
        <span
          key={chip.id}
          className="rounded-md border border-border px-1.5 text-xs text-muted-foreground"
        >
          {chip.label}
        </span>
      ))}
    </span>
  ) : null;
  return (
    <a
      ref={link}
      href={props.href}
      onClick={open}
      aria-current={props.selected ? "true" : undefined}
      className={cn(
        "flex min-w-0 gap-x-3 gap-y-1 px-4 py-2.5 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted aria-[current]:bg-muted",
        props.compact ? "flex-col" : "items-center",
      )}
    >
      <span className="flex min-w-0 shrink-0 items-center gap-2 md:w-44">
        <PersonAvatar
          name={props.person.name}
          avatarUrl={props.person.avatarUrl}
        />
        <span className="truncate">{props.person.name}</span>
        {props.shortId ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {props.shortId}
          </span>
        ) : null}
        {props.unread ? (
          <span className="size-1.5 shrink-0 rounded-full bg-primary">
            <span className="sr-only">{t("inbox.unread")}</span>
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(props.unread ? "font-semibold" : "font-medium")}>
          {props.title}
        </span>
        {props.preview ? (
          <span className="text-muted-foreground">
            {props.compact ? <br /> : " "}
            {props.preview}
          </span>
        ) : null}
      </span>
      {chips}
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <time dateTime={props.time}>
          {relativeTime(props.time, i18n.language)}
        </time>
        {props.assignee === undefined ? null : props.assignee ? (
          <span className="flex">
            <PersonAvatar
              name={props.assignee.name}
              avatarUrl={props.assignee.avatarUrl}
            />
            <span className="sr-only">
              {t("inbox.assignedTo", { name: props.assignee.name ?? "" })}
            </span>
          </span>
        ) : (
          <span className="flex">
            <UserRound aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("inbox.unassigned")}</span>
          </span>
        )}
      </span>
    </a>
  );
}

export interface InboxPerson {
  name: string | null;
  avatarUrl?: string | null;
}
