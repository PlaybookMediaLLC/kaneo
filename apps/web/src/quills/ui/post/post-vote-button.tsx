import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { ArrowUpIcon } from "../arrow-up-icon";
import { ConfirmAction } from "../confirm-action";
import { cn } from "../upstream";
import { StateView } from "../state-view";

export interface PostVoteButtonProps {
  voted: boolean;
  voteCount: number;
  disabled?: boolean;
  loading?: boolean;
  problem?: PortalProblem | null;
  onRetry?: () => void;
  onVote: (voted: boolean) => Promise<void>;
}

export function PostVoteButton(props: PostVoteButtonProps) {
  const { t } = useTranslation("quills");
  return (
    <div className="portal-vote relative z-10 shrink-0 text-xs">
      <StateView problem={props.problem ?? null} onRetry={props.onRetry}>
        <ConfirmAction
          labelKey={props.voted ? "post.removeVote" : "post.vote"}
          pressed={props.voted}
          disabled={props.disabled || props.loading}
          className={cn(
            "h-7 min-w-13 gap-1.5 rounded-full px-2.5 text-xs tabular-nums shadow-none sm:h-7 sm:text-xs",
            props.voted &&
              "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
          )}
          onConfirm={() => props.onVote(!props.voted)}
        >
          <ArrowUpIcon className="size-[11px]" />
          <span aria-hidden="true">{props.voteCount}</span>
        </ConfirmAction>
      </StateView>
      <span className="sr-only" aria-live="polite">
        {t("post.votes", { count: props.voteCount })}
      </span>
    </div>
  );
}
