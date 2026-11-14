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
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { PostActions } from "./parts/post-actions";
import { PostAttachments } from "./parts/post-attachments";
import { PostCommentsSection } from "./parts/post-comments-section";
import { PostVote } from "./parts/post-vote";
import { RelatedRequests } from "./parts/related-requests";

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
            tags={data.tags}
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
                  <a
                    className="block rounded-xl bg-muted/60 px-4 py-3 text-sm hover:bg-muted"
                    href={portalHref(
                      props.workspaceId,
                      `posts/${data.mergedInto.id}`,
                    )}
                  >
                    {t("post.mergedInto", { title: data.mergedInto.title })}
                  </a>
                ) : null}
                <MarkdownContent customer content={data.content} />
                <PostAttachments
                  workspaceId={props.workspaceId}
                  viewer={viewer}
                  attachments={data.attachments}
                />
                <PostVote
                  voted={currentVote?.voted ?? data.voted}
                  voteCount={
                    currentVote ? currentVote.voteCount : data.voteCount
                  }
                  importance={currentVote?.importance ?? data.importance}
                  canVote={data.canVote}
                  loading={vote.isPending}
                  problem={vote.error}
                  thanks={Boolean(
                    currentVote?.voted &&
                    data.canComment &&
                    !data.isCommentsLocked,
                  )}
                  onRetry={() => vote.reset()}
                  onVote={async (voted, importance) => {
                    await vote.mutateAsync({
                      param: { workspace: props.workspaceId, postId },
                      json: { voted, importance },
                    });
                  }}
                />
                <RelatedRequests
                  workspaceId={props.workspaceId}
                  viewer={viewer}
                  postId={postId}
                  title={data.title}
                />
                <PostCommentsSection
                  workspaceId={props.workspaceId}
                  postId={postId}
                  viewer={viewer}
                  canComment={data.canComment && !data.isCommentsLocked}
                  open={!data.isCommentsLocked && !data.mergedInto}
                  count={comments.hasNextPage ? data.commentCount : undefined}
                  comments={comments.data.pages.flatMap((page) => page.items)}
                  loadingMore={comments.isFetchingNextPage}
                  onLoadMore={
                    comments.hasNextPage
                      ? () => void comments.fetchNextPage()
                      : undefined
                  }
                />
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
