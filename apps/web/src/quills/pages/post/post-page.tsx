import { useTranslation } from "react-i18next";
import { Button } from "../../ui/upstream";
import { portalHref } from "../../core/portal-href";
import { useGetPortalPost } from "../../hooks/feedback/use-get-portal-post";
import { useListPortalPostComments } from "../../hooks/feedback/use-list-portal-post-comments";
import { useSetPortalVote } from "../../hooks/feedback/use-set-portal-vote";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { PostDetail } from "../../ui/post/post-detail";
import { PostVoteButton } from "../../ui/post/post-vote-button";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { PostActions } from "./parts/post-actions";

export interface PostPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function PostPage(props: PostPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const postId = props.params.postId ?? "";
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const input = {
    param: {
      workspace: canLoad ? props.workspaceId : "",
      postId: canLoad ? postId : "",
    },
  };
  const post = useGetPortalPost(input, portal.viewer);
  const comments = useListPortalPostComments(
    { ...input, query: { offset: "0", limit: "100" } },
    portal.viewer,
  );
  const vote = useSetPortalVote(portal.viewer);
  const currentVote = vote.data?.postId === post.data?.id ? vote.data : null;

  return (
    <PageFrame
      titleKey="post.title"
      displayTitle={canLoad ? post.data?.title : undefined}
      token="none"
      tokenScope={undefined}
      persistToken={false}
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, `posts/${postId}`)}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={post.isLoading || comments.isLoading}
            problem={post.error ?? comments.error ?? null}
            onRetry={() => {
              void post.refetch();
              void comments.refetch();
            }}
          >
            {post.data && comments.data ? (
              <>
                <a
                  className="text-sm text-muted-foreground hover:text-foreground"
                  href={portalHref(
                    props.workspaceId,
                    `boards/${post.data.board.id}`,
                  )}
                >
                  {post.data.board.name}
                </a>
                <PostDetail post={post.data} hideTitle />
                <PostVoteButton
                  voted={currentVote?.voted ?? post.data.voted}
                  voteCount={currentVote?.voteCount ?? post.data.voteCount}
                  disabled={!post.data.canVote}
                  loading={vote.isPending}
                  problem={vote.error}
                  onRetry={() => vote.reset()}
                  onVote={async (voted) => {
                    await vote.mutateAsync({
                      param: { workspace: props.workspaceId, postId },
                      json: { voted },
                    });
                  }}
                />
                <PostActions
                  post={post.data}
                  comments={comments.data.pages.flatMap((page) => page.items)}
                  postId={postId}
                  workspaceId={props.workspaceId}
                  viewer={portal.viewer}
                />
                {comments.hasNextPage ? (
                  <Button
                    type="button"
                    loading={comments.isFetchingNextPage}
                    onClick={() => void comments.fetchNextPage()}
                  >
                    {t("post.loadMore")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
