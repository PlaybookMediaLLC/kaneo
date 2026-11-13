import {
  IconBellOutline18,
  IconPen3Outline18,
  IconTrashOutline18,
} from "nucleo-ui-essential-outline-18";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../../core/relative-time";
import { ConfirmAction } from "../confirm-action";
import { PersonAvatar } from "../person-avatar";
import { ShareActions } from "../share-actions";
import { StatusIcon } from "./status-icon";

export interface PostSidebarProps {
  author: { name: string | null; avatarUrl: string | null };
  createdAt: string;
  status: { name: string; color: string } | null;
  stage: string | null;
  board: { name: string; href: string };
  /** The viewer's follow state; leave it unset when the viewer cannot follow. */
  following?: boolean;
  /** A sign-in link that replaces the follow control for a visitor. */
  signInHref?: string;
  onFollowChange?: (following: boolean) => Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
}

const section =
  "[&_h2]:mb-2.5 [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-foreground";
const item =
  "flex w-full items-center gap-2 rounded-md py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5";
// Resets the upstream button so a write keeps the look of the other rail items.
const confirmItem = `${item} h-auto justify-start border-0 bg-transparent px-0 font-normal shadow-none before:hidden hover:bg-transparent aria-pressed:bg-transparent aria-pressed:text-foreground sm:h-auto sm:text-sm dark:bg-transparent`;

/** The author, details and actions beside a post. */
export function PostSidebar(props: PostSidebarProps) {
  const { t, i18n } = useTranslation("quills");
  const author = props.author.name?.trim() || t("post.anonymousAuthor");
  return (
    <aside
      className={`portal-post-sidebar flex min-w-0 flex-col gap-7 md:sticky md:top-8 ${section}`}
    >
      <section aria-labelledby="post-author">
        <h2 id="post-author">{t("post.authorHeading")}</h2>
        <div className="flex items-center gap-2.5">
          <PersonAvatar
            name={author}
            avatarUrl={props.author.avatarUrl}
            className="size-7 text-xs"
          />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{author}</p>
            <time
              dateTime={props.createdAt}
              title={new Date(props.createdAt).toLocaleString(i18n.language)}
            >
              {relativeTime(props.createdAt, i18n.language)}
            </time>
          </div>
        </div>
      </section>
      <section aria-labelledby="post-details">
        <h2 id="post-details">{t("post.details")}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm [&_dt]:text-muted-foreground">
          {props.status ? (
            <>
              <dt>{t("post.status")}</dt>
              <dd className="flex items-center gap-1.5">
                <StatusIcon
                  stage={props.stage}
                  color={props.status.color}
                  className="size-3.5"
                />
                {props.status.name}
              </dd>
            </>
          ) : null}
          <dt>{t("post.board")}</dt>
          <dd>
            <a className="hover:underline" href={props.board.href}>
              {props.board.name}
            </a>
          </dd>
        </dl>
      </section>
      <section aria-labelledby="post-actions">
        <h2 id="post-actions">{t("post.actions")}</h2>
        <ul className="grid gap-0.5">
          {props.signInHref ? (
            <li>
              <a className={item} href={props.signInHref}>
                <IconBellOutline18 aria-hidden="true" />
                {t("post.follow")}
              </a>
            </li>
          ) : props.following !== undefined && props.onFollowChange ? (
            <li>
              <ConfirmAction
                labelKey={props.following ? "post.following" : "post.follow"}
                pressed={props.following}
                className={confirmItem}
                onConfirm={() => props.onFollowChange!(!props.following)}
              >
                <IconBellOutline18 aria-hidden="true" />
                {t(props.following ? "post.following" : "post.follow")}
              </ConfirmAction>
            </li>
          ) : null}
          {props.onEdit ? (
            <li>
              <button type="button" className={item} onClick={props.onEdit}>
                <IconPen3Outline18 aria-hidden="true" />
                {t("post.editPost")}
              </button>
            </li>
          ) : null}
          {props.onDelete ? (
            <li>
              <button type="button" className={item} onClick={props.onDelete}>
                <IconTrashOutline18 aria-hidden="true" />
                {t("post.deletePost")}
              </button>
            </li>
          ) : null}
        </ul>
        <ShareActions />
      </section>
    </aside>
  );
}
