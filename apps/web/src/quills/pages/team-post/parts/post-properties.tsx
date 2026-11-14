import type { GetPostResponse } from "../../../api/team/get-post";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { PostDemand } from "./post-demand";
import { PostFields } from "./post-fields";
import { PostLinks } from "./post-links";
import { PostMerge } from "./post-merge";
import { PostScore } from "./post-score";
import { PostVoters } from "./post-voters";

export interface PostPropertiesProps {
  workspaceId: string;
  post: GetPostResponse;
  statuses: ListStatusesResponse["statuses"];
  boards: ListBoardsResponse["items"];
  onScoreSaved: () => void;
}

/** The properties panel of a post. Each section loads and changes its own data. */
export function PostProperties(props: PostPropertiesProps) {
  const { workspaceId, post } = props;
  return (
    <div className="grid divide-y divide-border">
      <PostFields
        workspaceId={workspaceId}
        post={post}
        statuses={props.statuses}
        boards={props.boards}
      />
      <PostVoters workspaceId={workspaceId} post={post} />
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
