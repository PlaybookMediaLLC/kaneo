import type { FindPortalSimilarPostsResponse } from "../api/feedback/find-portal-similar-posts";
import { isStrongMatch } from "../core/strong-match";
import { useListPortalVotedPosts } from "../hooks/feedback/use-list-portal-voted-posts";
import { useSetPortalVote } from "../hooks/feedback/use-set-portal-vote";
import { SimilarPosts } from "../ui/post/similar-posts";
import { usePortalRuntime } from "./runtime";

export interface SimilarRequestsProps {
  workspaceId: string;
  /** The title that the viewer types in the composer. */
  title: string;
  posts: FindPortalSimilarPostsResponse["items"];
  /** True for a board where the viewer may vote. */
  canVote: (boardId: string) => boolean;
}

/** The composer's similar posts. A strong match offers a vote instead of a new post. */
export function SimilarRequests(props: SimilarRequestsProps) {
  const portal = usePortalRuntime();
  const signedIn = portal.viewer.kind === "user";
  // Only a signed-in viewer has votes, and only listed matches need the marks.
  const voted = useListPortalVotedPosts(
    {
      param: {
        workspace: signedIn && props.posts.length ? props.workspaceId : "",
      },
    },
    portal.viewer,
  );
  const vote = useSetPortalVote(portal.viewer);
  const voteIds = new Set(
    props.posts
      .filter(
        (post) =>
          signedIn &&
          props.canVote(post.board.id) &&
          isStrongMatch(props.title, post.title),
      )
      .map((post) => post.id),
  );
  return (
    <SimilarPosts
      workspaceId={props.workspaceId}
      posts={props.posts}
      votedIds={new Set(voted.data?.postIds)}
      // Until the votes load, no offer shows, so a voted post never offers a second vote.
      voteIds={voted.data ? voteIds : undefined}
      onVote={async (postId) => {
        await vote.mutateAsync({
          param: { workspace: props.workspaceId, postId },
          json: { voted: true },
        });
      }}
    />
  );
}
