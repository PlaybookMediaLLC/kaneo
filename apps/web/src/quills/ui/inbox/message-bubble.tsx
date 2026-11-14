import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clockTime } from "../../core/short-date";
import { PersonAvatar } from "../person-avatar";
import { cn } from "../upstream";
import type { InboxPerson } from "./inbox-types";

export interface MessageBubbleProps {
  /** customer: left and gray. team: right and blue. note: right, yellow, labelled "Note". */
  kind: "customer" | "team" | "note";
  author: InboxPerson;
  /** The message body, such as MarkdownContent and attachments. */
  children: ReactNode;
  /** An ISO time. */
  time: string;
  /** A delivery failure under the bubble, such as "Email failed". */
  failure?: string | null;
}

const bubbles = {
  customer: "rounded-bl-md bg-muted text-foreground",
  team: "rounded-br-md bg-info-foreground text-background [&_a]:text-background",
  note: "rounded-br-md border border-warning/30 bg-warning/10 text-foreground",
} as const;

/** One message of a thread, with the author's avatar, the time and the delivery state. */
export function MessageBubble({
  kind,
  author,
  children,
  time,
  failure,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation("quills");
  const mine = kind !== "customer";
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      <PersonAvatar
        colored
        name={author.name}
        avatarUrl={author.avatarUrl}
        className="mb-5 size-7 text-[10px]"
      />
      <div
        className={cn(
          "flex min-w-0 max-w-[80%] flex-col gap-1",
          mine ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "min-w-0 rounded-2xl px-3.5 py-2 text-sm [overflow-wrap:anywhere]",
            bubbles[kind],
          )}
        >
          {kind === "note" ? (
            <p className="mb-1 text-xs font-semibold text-warning-foreground">
              {t("inbox.note")}
            </p>
          ) : null}
          {children}
        </div>
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          {author.name ? (
            <>
              <span>{author.name}</span>
              <span
                aria-hidden="true"
                className="size-0.5 rounded-full bg-current"
              />
            </>
          ) : null}
          <time dateTime={time}>{clockTime(time, i18n.language)}</time>
        </p>
        {failure ? (
          <p
            role="status"
            className="flex items-center gap-1 px-1 text-xs text-destructive-foreground"
          >
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            {failure}
          </p>
        ) : null}
      </div>
    </div>
  );
}
