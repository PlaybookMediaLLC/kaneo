import { useTranslation } from "react-i18next";
import type { PortalBoard } from "../../../api/feedback/portal-board.type";
import { portalHref } from "../../../core/portal-href";
import { Button } from "../../../ui/upstream";

export interface BoardIntroProps {
  board: PortalBoard;
  workspaceId: string;
  viewerKind: string;
  onSubmit: () => void;
}

export function BoardIntro({
  board,
  workspaceId,
  viewerKind,
  onSubmit,
}: BoardIntroProps) {
  const { t } = useTranslation("quills");
  const boardId = board.id;
  return (
    <>
      <header className="portal-feedback-heading space-y-3 [&>a]:text-xs [&>a]:text-muted-foreground [&>h2]:text-xl [&>h2]:font-semibold [&>p]:text-muted-foreground">
        <a href={portalHref(workspaceId)}>{t("feedback.backToBoards")}</a>
        {board.description ? <p>{board.description}</p> : null}
      </header>
      <div className="portal-feedback-composer flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs [&>p]:text-muted-foreground [&_a]:inline-flex [&_a]:rounded-full [&_a]:bg-primary [&_a]:px-4 [&_a]:py-2 [&_a]:text-primary-foreground">
        <p>{t("feedback.prompt")}</p>
        {viewerKind === "user" && board.canSubmit ? (
          <Button type="button" onClick={onSubmit}>
            {t("feedback.submit")}
          </Button>
        ) : viewerKind !== "user" ? (
          <p>
            {t("feedback.signInToSubmit")}{" "}
            <a
              href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(workspaceId, `boards/${boardId}`))}`}
            >
              {t("feedback.signIn")}
            </a>
          </p>
        ) : null}
      </div>
    </>
  );
}
