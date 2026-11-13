import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import { StatusIcon } from "./post/status-icon";
import { ShareActions } from "./share-actions";

export interface BoardNavigationProps {
  boards: Array<{ id: string; name: string; postCount?: number | null }>;
  boardId?: string;
  workspaceId: string;
  /** The public stages to filter by; the section is hidden without them. */
  stages?: Array<{ value: string; label: string; color: string | null }>;
  stage?: string;
  onStageChange?: (value: string) => void;
}

const section =
  "[&_h2]:mb-2.5 [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-foreground";
const item =
  "flex w-full items-center gap-2 whitespace-nowrap rounded-md py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground aria-pressed:font-medium aria-pressed:text-foreground";

export function BoardNavigation({
  boards,
  workspaceId,
  boardId,
  stages = [],
  stage,
  onStageChange,
}: BoardNavigationProps) {
  const { t } = useTranslation("quills");
  return (
    <aside
      className={`portal-board-sidebar flex min-w-0 flex-col gap-7 md:sticky md:top-8 ${section}`}
    >
      <section aria-labelledby="feedback-boards">
        <h2 id="feedback-boards">{t("feedback.boards")}</h2>
        {boards.length ? (
          <ul className="flex gap-4 overflow-x-auto md:grid md:gap-0.5">
            <li>
              <a
                className={item}
                href={portalHref(workspaceId)}
                aria-current={boardId ? undefined : "page"}
              >
                {t("feedback.allFeedback")}
              </a>
            </li>
            {boards.map((board) => (
              <li key={board.id}>
                <a
                  className={item}
                  href={portalHref(workspaceId, `boards/${board.id}`)}
                  aria-current={board.id === boardId ? "page" : undefined}
                >
                  {board.name}
                  <span className="sr-only">
                    {t("feedback.boardDescription", {
                      count: board.postCount ?? 0,
                    })}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("feedback.noBoards")}
          </p>
        )}
      </section>
      {stages.length && onStageChange ? (
        <section aria-labelledby="feedback-statuses">
          <h2 id="feedback-statuses">{t("feedback.stage")}</h2>
          <ul className="flex gap-4 overflow-x-auto md:grid md:gap-0.5">
            {stages.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={item}
                  aria-pressed={option.value === stage}
                  onClick={() =>
                    onStageChange(option.value === stage ? "" : option.value)
                  }
                >
                  <StatusIcon
                    stage={option.value}
                    color={option.color}
                    className="size-3.5"
                  />
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="feedback-actions" className="hidden md:block">
        <h2 id="feedback-actions">{t("feedback.actions")}</h2>
        <ShareActions />
      </section>
    </aside>
  );
}
