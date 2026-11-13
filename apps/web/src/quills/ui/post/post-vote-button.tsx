import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { ConfirmAction } from "../confirm-action";
import { ArrowUp } from "../upstream";
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
    <div className="portal-vote flex flex-col items-center gap-2 text-xs text-muted-foreground">
      <StateView problem={props.problem ?? null} onRetry={props.onRetry}>
        <ConfirmAction
          labelKey={props.voted ? "post.removeVote" : "post.vote"}
          pressed={props.voted}
          disabled={props.disabled || props.loading}
          onConfirm={() => props.onVote(!props.voted)}
        >
          <ArrowUp aria-hidden="true" />
        </ConfirmAction>
      </StateView>
      <span aria-live="polite">
        {t("post.votes", { count: props.voteCount })}
      </span>
    </div>
  );
}
