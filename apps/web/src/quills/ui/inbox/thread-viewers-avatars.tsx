import { useTranslation } from "react-i18next";
import type { ThreadViewer } from "../../hooks/team/use-thread-presence";
import { PersonAvatar } from "../person-avatar";

export interface ThreadViewersAvatarsProps {
  viewers: readonly ThreadViewer[];
}

/** Compact teammate presence indicator shown in conversation and ticket headers (#324). */
export function ThreadViewersAvatars({ viewers }: ThreadViewersAvatarsProps) {
  const { t } = useTranslation("quills");
  if (!viewers.length) return null;
  const replying = viewers.filter((viewer) => viewer.state === "replying");
  const label =
    replying.length > 0
      ? t("inbox.guardrail.teammateReplying", {
          name: replying[0]?.displayName ?? t("inbox.teammate"),
        })
      : t("inbox.guardrail.teammatesViewing", { count: viewers.length });

  return (
    <div className="flex items-center gap-1.5" title={label} aria-label={label}>
      <div className="flex -space-x-1.5">
        {viewers.slice(0, 3).map((viewer) => (
          <PersonAvatar
            key={viewer.principalId}
            colored
            name={viewer.displayName}
            avatarUrl={viewer.avatarUrl}
            className={
              viewer.state === "replying"
                ? "size-6 text-[10px] ring-2 ring-warning"
                : "size-6 text-[10px] ring-2 ring-background"
            }
          />
        ))}
      </div>
    </div>
  );
}
