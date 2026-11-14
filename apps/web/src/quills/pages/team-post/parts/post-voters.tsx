import { X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import { useAddPostProxyVote } from "../../../hooks/team/use-add-post-proxy-vote";
import { useListPostVoters } from "../../../hooks/team/use-list-post-voters";
import { useListUsers } from "../../../hooks/team/use-list-users";
import { useRemovePostVote } from "../../../hooks/team/use-remove-post-vote";
import { useTeamRuntime } from "../../../team/runtime";
import { PersonAvatar } from "../../../ui/person-avatar";
import { Button, Input, useDebouncedValue } from "../../../ui/upstream";

export interface PostVotersProps {
  workspaceId: string;
  post: GetPostResponse;
}

const importance = {
  nice: "team-post.nice",
  important: "team-post.important",
  critical: "team-post.critical",
} as const;

/** The voters of a post, their importance, and the votes that the team adds for customers. */
export function PostVoters({ workspaceId, post }: PostVotersProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const heading = useId();
  const param = { workspaceId, postId: post.id };
  const voters = useListPostVoters(
    { param, query: { offset: "0", limit: "50" } },
    team.viewer,
  );
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 300);
  const users = useListUsers(
    {
      param: { workspaceId: search ? workspaceId : "" },
      query: { search, limit: "5" },
    },
    team.viewer,
  );
  const add = useAddPostProxyVote(team.viewer);
  const remove = useRemovePostVote(team.viewer);
  const items = voters.data?.pages.flatMap((page) => page.items) ?? [];
  const voted = new Set(items.map((voter) => voter.principalId));
  const locked = !team.permissions.update;
  const failed = voters.error ?? users.error ?? add.error ?? remove.error;
  return (
    <section aria-labelledby={heading} className="grid gap-2 py-2">
      <h3 id={heading} className="text-sm font-medium">
        {t("team-post.votes", { count: post.voteCount })}
      </h3>
      {failed ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {t("core.problem.failed")}
        </p>
      ) : null}
      <ul className="grid gap-1 text-sm">
        {items.map((voter) => {
          const name = voter.displayName ?? t("team-post.anonymous");
          return (
            <li
              key={voter.principalId}
              className="flex min-h-7 items-center gap-2"
            >
              <PersonAvatar name={name} avatarUrl={voter.avatarUrl} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {voter.importance ? (
                <span className="text-xs text-muted-foreground">
                  {t(importance[voter.importance])}
                </span>
              ) : null}
              {voter.addedByPrincipalId && !locked ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("team-post.removeVote", { name })}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate({
                      param: { ...param, principalId: voter.principalId },
                    })
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {voters.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          loading={voters.isFetchingNextPage}
          onClick={() => void voters.fetchNextPage()}
        >
          {t("team-post.moreVoters")}
        </Button>
      ) : null}
      {locked ? null : (
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("team-post.addVote")}
          <Input
            type="search"
            size="sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      {!locked && search && users.data ? (
        <ul className="grid gap-1">
          {users.data.items
            .filter((user) => !voted.has(user.principalId))
            .map((user) => (
              <li key={user.principalId}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  disabled={add.isPending}
                  onClick={() => {
                    add.mutate({
                      param: { ...param, principalId: user.principalId },
                    });
                    setText("");
                  }}
                >
                  {t("team-post.addVoteFor", { name: user.name })}
                </Button>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}
