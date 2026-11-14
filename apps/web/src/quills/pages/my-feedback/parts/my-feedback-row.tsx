import { useTranslation } from "react-i18next";
import { portalHref } from "../../../core/portal-href";
import { relativeTime } from "../../../core/relative-time";

export interface MyFeedbackRowProps {
  workspaceId: string;
  item: {
    id: string;
    title: string;
    board: { name: string };
    status: { name: string } | null;
    isAuthor: boolean;
    voted: boolean;
    following: boolean;
    lastChangedAt: string;
  };
}

/** One post of the caller's feedback: where it stands and why the caller sees it. */
export function MyFeedbackRow({ workspaceId, item }: MyFeedbackRowProps) {
  const { t, i18n } = useTranslation("quills");
  const marks = [
    item.isAuthor && t("my-feedback.mine"),
    item.voted && t("my-feedback.voted"),
    item.following && t("my-feedback.following"),
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <a
        className="font-medium underline-offset-4 hover:underline"
        href={portalHref(workspaceId, `posts/${item.id}`)}
      >
        {item.title}
      </a>
      <span className="text-sm text-muted-foreground">
        {t("my-feedback.place", {
          board: item.board.name,
          status: item.status?.name ?? t("my-feedback.noStatus"),
        })}
      </span>
      <span className="w-full text-xs text-muted-foreground">
        {[
          ...marks,
          t("my-feedback.changed", {
            time: relativeTime(item.lastChangedAt, i18n.language),
          }),
        ].join(" · ")}
      </span>
    </li>
  );
}
