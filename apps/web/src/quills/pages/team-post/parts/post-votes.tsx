import { ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import { useListPostVoters } from "../../../hooks/team/use-list-post-voters";
import { useTeamRuntime } from "../../../team/runtime";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  Button,
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "../../../ui/upstream";
import { PostVoters } from "./post-voters";

export interface PostVotesProps {
  workspaceId: string;
  post: GetPostResponse;
}

const STACK = 4;

/** The voter avatars and the vote pill of a request. The pill opens the voters and the proxy vote. */
export function PostVotes({ workspaceId, post }: PostVotesProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  // The same request as the voter list in the popover, so it comes from the cache.
  const voters = useListPostVoters(
    {
      param: { workspaceId, postId: post.id },
      query: { offset: "0", limit: "50" },
    },
    team.viewer,
  );
  const first = voters.data?.pages[0]?.items.slice(0, STACK) ?? [];
  return (
    <div className="ms-auto flex items-center gap-2">
      <span aria-hidden="true" className="flex -space-x-1.5">
        {first.map((voter) => (
          <PersonAvatar
            key={voter.principalId}
            colored
            name={voter.displayName}
            avatarUrl={voter.avatarUrl}
            className="size-6 ring-2 ring-background"
          />
        ))}
      </span>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-md px-2"
              aria-label={t("team-post.votes", { count: post.voteCount })}
            />
          }
        >
          <ArrowUp aria-hidden="true" />
          {post.voteCount}
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-80 p-3">
          <PostVoters workspaceId={workspaceId} post={post} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}
