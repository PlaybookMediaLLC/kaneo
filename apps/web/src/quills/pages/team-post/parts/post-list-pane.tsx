import { useTranslation } from "react-i18next";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { ListPane } from "../../../ui/inbox/list-pane";
import { PostStatusIcon } from "../../../ui/inbox/post-status-icon";
import { RequestRow } from "../../../ui/inbox/request-row";
import {
  postRow,
  statusIcon,
  type ListedPost,
} from "../../team-posts/post-list";

export interface PostListPaneProps {
  /** The posts of the inbox list, in its order. */
  posts: readonly ListedPost[];
  statuses: ListStatusesResponse["statuses"];
  boardName: ReadonlyMap<string, string>;
  activeId: string;
  /** The address of a post, with the inbox filters. */
  href: (postId: string) => string;
  onOpen: (postId: string) => void;
  loading: boolean;
}

/** The list pane beside an open post: compact request cards of the inbox list. The main pane shows a failure. */
export function PostListPane(props: PostListPaneProps) {
  const { t } = useTranslation("quills");
  return (
    <ListPane
      title={t("team-posts.title")}
      headingLevel={2}
      loading={props.loading}
    >
      <ul className="grid gap-0.5">
        {props.posts.map((post) => (
          <li key={post.id}>
            <RequestRow
              {...postRow(
                post,
                props.boardName.get(post.boardId),
                t("team-posts.anonymous"),
              )}
              icon={<PostStatusIcon {...statusIcon(post, props.statuses)} />}
              compact
              href={props.href(post.id)}
              onOpen={() => props.onOpen(post.id)}
              selected={post.id === props.activeId}
            />
          </li>
        ))}
      </ul>
    </ListPane>
  );
}
