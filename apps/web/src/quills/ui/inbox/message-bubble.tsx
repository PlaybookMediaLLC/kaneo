import { Lock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clockTime } from "../../core/short-date";
import { PersonAvatar } from "../person-avatar";
import { cn } from "../upstream";
import type { InboxPerson } from "./inbox-types";

export interface MessageBubbleProps {
  /**
   * other: left and gray. self: right, in the primary color. note: right, amber dashed with lock icon, labelled "Internal note".
   * "self" is the viewer's side: the team in the teammate app, the customer in the portal.
   */
  kind: "other" | "self" | "note";
  author: InboxPerson;
  /** The message body, such as MarkdownContent and attachments. */
  children: ReactNode;
  /** An ISO time. */
  time: string;
  /** A delivery failure under the bubble, such as "Email failed". */
  failure?: string | null;
  /** Optional footer strip inside/below the bubble (such as scheduled send countdown & Undo). */
  footer?: ReactNode;
  /** False hides the avatar, such as for the customer's own messages in the portal. */
  avatar?: boolean;
}

const bubbles = {
  other: "rounded-bl-md bg-muted text-foreground",
  self: "rounded-br-md bg-primary text-primary-foreground [&_a]:text-primary-foreground",
  note: "rounded-br-md border border-l-4 border-dashed border-warning/60 bg-warning/10 text-foreground",
} as const;

/** One message of a thread, with the author's avatar, the time and the delivery state. */
export function MessageBubble({
  kind,
  author,
  children,
  time,
  failure,
  footer,
  avatar = true,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation("quills");
  const mine = kind !== "other";
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      {avatar ? (
        <PersonAvatar
          colored
          name={author.name}
          avatarUrl={author.avatarUrl}
          className="mb-5 size-7 text-xs"
        />
      ) : null}
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
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-warning-foreground">
              <Lock aria-hidden="true" className="size-3" />
              {t("inbox.note")}
            </p>
          ) : null}
          {children}
          {footer}
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
