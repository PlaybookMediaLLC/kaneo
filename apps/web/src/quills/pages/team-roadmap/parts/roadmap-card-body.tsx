import { Link } from "@tanstack/react-router";
import { ArrowUp, Ellipsis, MessageCircle } from "lucide-react";
import { type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { plainText } from "../../../core/plain-text";
import { statusProgress } from "../../../core/status-progress";
import { teamHref } from "../../../team/team-href";
import { BoardDot } from "../../../ui/inbox/board-dot";
import { IconButton } from "../../../ui/inbox/icon-button";
import { PostStatusIcon } from "../../../ui/inbox/post-status-icon";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../../ui/upstream";
import { CardDisplayContext } from "../card-display";
import type { RoadmapPost } from "../roadmap-moves";

export interface RoadmapCardBodyProps {
  workspaceId: string;
  post: RoadmapPost;
  /** Pre-stripped plain text title when computed by the card wrapper. */
  title?: string;
  /** The status of the column that shows the card. */
  statusId: string;
  /** The board name. */
  board: string | null;
  statuses: readonly {
    id: string;
    name: string;
    category: string;
    color?: string | null;
  }[];
  /** The drag activator: Space on the title link starts a keyboard drag. */
  activatorRef?: (element: HTMLElement | null) => void;
  /** The copy that follows the pointer during a drag: no link and no menu. */
  preview?: boolean;
  /** The drag instructions for screen readers, when the card can move. */
  describedBy?: string;
  /** Moves the card; `byMenu` is true for the Move to menu. Left out without the update permission. */
  onMove?: (post: RoadmapPost, statusId: string, byMenu?: boolean) => void;
  /** Opens the Create task or Link existing task dialog (RFC 0005). Left out without the update permission. */
  onTask?: (post: RoadmapPost, kind: "create" | "link") => void;
}

/**
 * The content of a roadmap card: the board and the author, the status and the title link, the
 * vote and comment chips, the creation month and the Move to menu. RoadmapCard memoizes it, so a drag over the board does not render it again.
 */
export function RoadmapCardBody({
  workspaceId,
  post,
  statusId,
  onMove,
  onTask,
  ...props
}: RoadmapCardBodyProps) {
  const { t, i18n } = useTranslation("quills");
  const title = props.title ?? plainText(post.title);
  const status = props.statuses.find((item) => item.id === statusId);
  const show = useContext(CardDisplayContext);
  const board = show.board ? props.board : null;
  const chip = (key: string, value: number, icon: ReactNode) => (
    <span className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-border px-1.5 text-xs text-muted-foreground tabular-nums [&>svg]:text-faint-foreground">
      {icon}
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">{t(key, { count: value })}</span>
    </span>
  );
  return (
    <>
      {board || show.author ? (
        <div className="mb-1 flex h-5 items-center gap-2 text-xs text-muted-foreground">
          {board ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <BoardDot boardId={post.boardId} />
              <span className="truncate">{board}</span>
            </span>
          ) : null}
          {show.author ? (
            <PersonAvatar
              colored
              name={post.authorName ?? null}
              avatarUrl={post.authorAvatarUrl}
              className="ms-auto"
            />
          ) : null}
        </div>
      ) : null}
      <h3 className="flex items-start gap-2 text-sm font-medium leading-5 text-pretty">
        <span className="flex h-5 shrink-0 items-center">
          <PostStatusIcon
            color={status?.color}
            progress={statusProgress(props.statuses, statusId)}
          />
        </span>
        <span className="line-clamp-2 min-w-0">
          {props.preview ? (
            title
          ) : (
            <Link
              ref={props.activatorRef}
              to={teamHref(workspaceId, `/posts/${post.id}`)}
              aria-describedby={props.describedBy}
              className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {title}
            </Link>
          )}
        </span>
      </h3>
      {show.counts ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {chip(
            "inbox.votes",
            post.voteCount,
            <ArrowUp aria-hidden="true" className="size-3" />,
          )}
          {chip(
            "inbox.comments",
            post.commentCount,
            <MessageCircle aria-hidden="true" className="size-3" />,
          )}
        </div>
      ) : null}
      {show.created ? (
        <p className="mt-2 text-xs text-faint-foreground">
          {t("team-roadmap.created", {
            date: new Date(post.createdAt).toLocaleDateString(i18n.language, {
              month: "short",
              year: "numeric",
            }),
          })}
        </p>
      ) : null}
      {onMove && !props.preview ? (
        <Menu>
          <MenuTrigger
            render={
              <IconButton
                label={t("team-roadmap.move", { title })}
                className="absolute end-1 bottom-1 z-10 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>{t("team-roadmap.moveTo")}</MenuGroupLabel>
              <MenuRadioGroup
                value={statusId}
                onValueChange={(value) => onMove(post, String(value), true)}
              >
                {props.statuses.map((status) => (
                  <MenuRadioItem key={status.id} value={status.id}>
                    {status.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            {onTask ? (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => onTask(post, "create")}>
                  {t("team-post.createTask")}
                </MenuItem>
                <MenuItem onClick={() => onTask(post, "link")}>
                  {t("team-post.linkTask")}
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
}
