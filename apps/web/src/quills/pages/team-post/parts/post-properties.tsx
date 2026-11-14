import type { GetPostResponse } from "../../../api/team/get-post";
import { PostDemand } from "./post-demand";
import { PostLinks } from "./post-links";
import { PostMerge } from "./post-merge";
import { PostScore } from "./post-score";

export interface PostPropertiesProps {
  workspaceId: string;
  post: GetPostResponse;
  onScoreSaved: () => void;
}

/** The right panel of a request: demand, RICE score, links and merges. Each section loads its own data. */
export function PostProperties(props: PostPropertiesProps) {
  const { workspaceId, post } = props;
  return (
    <div className="grid divide-y divide-border">
      <PostDemand workspaceId={workspaceId} postId={post.id} />
      <PostScore
        workspaceId={workspaceId}
        post={post}
        onSaved={props.onScoreSaved}
      />
      <PostLinks workspaceId={workspaceId} postId={post.id} />
      <PostMerge workspaceId={workspaceId} post={post} />
    </div>
  );
}
