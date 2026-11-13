import { useTranslation } from "react-i18next";

import { portalHref } from "../core/portal-href";
export interface BoardNavigationProps {
  boards: Array<{ id: string; name: string; postCount?: number | null }>;
  boardId?: string;
  workspaceId: string;
}
export function BoardNavigation({
  boards,
  workspaceId,
  boardId,
}: BoardNavigationProps) {
  const { t } = useTranslation("quills");
  return (
    <aside
      className="portal-board-sidebar min-w-0 md:sticky md:top-6 [&_h2]:mb-4 [&_h2]:hidden [&_h2]:text-xs [&_h2]:font-medium [&_h2]:uppercase [&_h2]:tracking-widest md:[&_h2]:block [&_ul]:flex [&_ul]:gap-2 [&_ul]:overflow-x-auto md:[&_ul]:grid md:[&_ul]:gap-1 [&_li]:shrink-0 [&_a]:flex [&_a]:items-center [&_a]:justify-between [&_a]:gap-3 [&_a]:whitespace-nowrap [&_a]:rounded-full [&_a]:border [&_a]:border-border [&_a]:px-3 [&_a]:py-2 [&_a]:text-muted-foreground md:[&_a]:rounded-lg md:[&_a]:border-0 [&_a:hover]:bg-muted [&_a[aria-current]]:bg-muted [&_a[aria-current]]:text-foreground [&_strong]:font-medium"
      aria-labelledby="feedback-boards"
    >
      <h2 id="feedback-boards">{t("feedback.boards")}</h2>
      {boards.length ? (
        <ul>
          <li>
            <a
              href={portalHref(workspaceId)}
              aria-current={boardId ? undefined : "page"}
            >
              {t("feedback.allFeedback")}
            </a>
          </li>
          {boards.map((board) => (
            <li key={board.id}>
              <a
                href={portalHref(workspaceId, `boards/${board.id}`)}
                aria-current={board.id === boardId ? "page" : undefined}
              >
                <strong>{board.name}</strong>
                <span className="portal-board-count hidden text-xs tabular-nums md:inline">
                  {t("feedback.boardDescription", {
                    count: board.postCount ?? 0,
                  })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("feedback.noBoards")}</p>
      )}
    </aside>
  );
}
