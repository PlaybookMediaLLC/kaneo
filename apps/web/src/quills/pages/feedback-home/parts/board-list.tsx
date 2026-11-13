import { useTranslation } from "react-i18next";
import type { PortalBoard } from "../../../api/feedback/portal-board.type";
import { portalHref } from "../../../core/portal-href";
export interface BoardListProps {
  boards: PortalBoard[];
  workspaceId: string;
}
export function BoardList({ boards, workspaceId }: BoardListProps) {
  const { t } = useTranslation("quills");
  return (
    <section aria-labelledby="feedback-boards">
      <h2 id="feedback-boards">{t("feedback.boards")}</h2>
      {boards.length ? (
        <ul>
          {boards.map((board) => (
            <li key={board.id}>
              <a href={portalHref(workspaceId, `boards/${board.id}`)}>
                <strong>{board.name}</strong>
                {board.description ? <span>{board.description}</span> : null}
                <span>
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
    </section>
  );
}
