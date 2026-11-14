import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { ConfirmAction } from "../../../ui/confirm-action";
import { PostVoteButton } from "../../../ui/post/post-vote-button";

export type Importance = "nice" | "important" | "critical";
const levels = [
  { value: "nice", labelKey: "voting.nice" },
  { value: "important", labelKey: "voting.important" },
  { value: "critical", labelKey: "voting.critical" },
] as const;

export interface PostVoteProps {
  voted: boolean;
  /** Left out when the board hides vote counts. */
  voteCount?: number;
  importance: Importance | null;
  canVote: boolean;
  loading: boolean;
  problem: PortalProblem | null;
  /** Shows the thanks note after a vote in this visit. */
  thanks: boolean;
  onRetry: () => void;
  onVote: (voted: boolean, importance?: Importance) => Promise<void>;
}

/** The vote button and, after a vote, how much the post matters to the voter. */
export function PostVote(props: PostVoteProps) {
  const { t } = useTranslation("quills");
  const questionId = useId();
  return (
    <>
      <PostVoteButton
        voted={props.voted}
        voteCount={props.voteCount}
        disabled={!props.canVote}
        loading={props.loading}
        problem={props.problem}
        onRetry={props.onRetry}
        onVote={(voted) => props.onVote(voted)}
      />
      {props.voted && props.canVote ? (
        <div
          role="group"
          aria-labelledby={questionId}
          className="portal-vote-importance flex flex-wrap items-center gap-2 text-sm"
        >
          <span id={questionId} className="text-muted-foreground">
            {t("voting.question")}
          </span>
          {levels.map((level) => (
            <ConfirmAction
              key={level.value}
              labelKey={level.labelKey}
              pressed={props.importance === level.value}
              disabled={props.loading}
              className="h-7 rounded-full px-3 text-xs shadow-none sm:h-7 sm:text-xs"
              onConfirm={() => props.onVote(true, level.value)}
            />
          ))}
        </div>
      ) : null}
      {props.thanks ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("post.voteThanks")}
        </p>
      ) : null}
    </>
  );
}
