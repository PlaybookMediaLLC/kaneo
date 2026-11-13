import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPortalPost } from "../../hooks/feedback/use-get-portal-post";
import { useListPortalPostComments } from "../../hooks/feedback/use-list-portal-post-comments";
import { useSetPortalFollow } from "../../hooks/feedback/use-set-portal-follow";
import { useSetPortalVote } from "../../hooks/feedback/use-set-portal-vote";
import { usePortalRuntime } from "../../portal/runtime";
import { MarkdownContent } from "../../ui/markdown-content";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { PostSidebar } from "../../ui/post/post-sidebar";
import { PostVoteButton } from "../../ui/post/post-vote-button";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";
import { PostActions } from "./parts/post-actions";
import { PostCommentsSection } from "./parts/post-comments-section";

export interface PostPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function PostPage(props: PostPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const postId = props.params.postId ?? "";
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const input = {
    param: {
      workspace: canLoad ? props.workspaceId : "",
      postId: canLoad ? postId : "",
    },
  };
  const post = useGetPortalPost(input, viewer);
  const comments = useListPortalPostComments(
    { ...input, query: { offset: "0", limit: "100" } },
    viewer,
  );
  const vote = useSetPortalVote(viewer);
  const follow = useSetPortalFollow(viewer);
  const currentVote = vote.data?.postId === post.data?.id ? vote.data : null;
  const here = portalHref(props.workspaceId, `posts/${postId}`);
  const data = post.data;

  return (
    <PageFrame
      titleKey="post.title"
      displayTitle={canLoad ? data?.title : undefined}
      aside={
        data ? (
          <PostSidebar
            author={data.author}
            createdAt={data.createdAt}
            status={data.status}
            stage={data.stage}
            board={{
              name: data.board.name,
              href: portalHref(props.workspaceId, `boards/${data.board.id}`),
            }}
            following={viewer.kind === "user" ? data.following : undefined}
            signInHref={
              viewer.kind === "user"
                ? undefined
                : `/auth/sign-in?redirect=${encodeURIComponent(here)}`
            }
            onFollowChange={async (following) => {
              await follow.mutateAsync({
                param: { workspace: props.workspaceId, postId },
                json: { following },
              });
            }}
            onEdit={data.canEdit ? () => setEditOpen(true) : undefined}
            onDelete={data.canDelete ? () => setDeleteOpen(true) : undefined}
          />
        ) : null
      }
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={here}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={viewer.kind === "user"}
        >
          <StateView
            loading={post.isLoading || comments.isLoading}
            problem={post.error ?? comments.error ?? null}
            onRetry={() => {
              void post.refetch();
              void comments.refetch();
            }}
          >
            {data && comments.data ? (
              <>
                {data.pending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("post.pending")}
                  </p>
                ) : null}
                {data.mergedInto ? (
                  <p className="text-sm text-muted-foreground">
                    {t("post.mergedInto", { title: data.mergedInto.title })}
                  </p>
                ) : null}
                <MarkdownContent content={data.content} />
                <PostVoteButton
                  voted={currentVote?.voted ?? data.voted}
                  voteCount={currentVote?.voteCount ?? data.voteCount}
                  disabled={!data.canVote}
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
                <PostCommentsSection
                  workspaceId={props.workspaceId}
                  postId={postId}
                  viewer={viewer}
                  canComment={data.canComment && !data.isCommentsLocked}
                  comments={comments.data.pages.flatMap((page) => page.items)}
                />
                {comments.hasNextPage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-muted-foreground"
                    loading={comments.isFetchingNextPage}
                    onClick={() => void comments.fetchNextPage()}
                  >
                    {t("post.loadMore")}
                  </Button>
                ) : null}
                <PostActions
                  post={data}
                  postId={postId}
                  viewer={viewer}
                  workspaceId={props.workspaceId}
                  editOpen={editOpen}
                  deleteOpen={deleteOpen}
                  onEditOpenChange={setEditOpen}
                  onDeleteOpenChange={setDeleteOpen}
                />
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
