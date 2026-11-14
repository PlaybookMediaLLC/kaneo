import { useTranslation } from "react-i18next";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import { ListPane } from "../../../ui/inbox/list-pane";
import { PostStatusIcon } from "../../../ui/inbox/post-status-icon";
import { RequestFilters } from "../../../ui/inbox/request-filters";
import { RequestRow } from "../../../ui/inbox/request-row";
import {
  postRow,
  statusIcon,
  type ListedPost,
} from "../../team-posts/post-list";
import { filterPatch, type PostSearch } from "../../team-posts/post-search";
import { useRequestQuery } from "../../team-posts/use-request-query";

export interface PostListPaneProps {
  /** The posts of the request list, in its order. */
  posts: readonly ListedPost[];
  statuses: ListStatusesResponse["statuses"];
  boards: ListBoardsResponse["items"];
  /** The list filters of the address, which the filter menu and the search change. */
  search: PostSearch;
  onSearch: (patch: Partial<PostSearch>) => void;
  activeId: string;
  /** The address of a post, with the list filters. */
  href: (postId: string) => string;
  onOpen: (postId: string) => void;
  loading: boolean;
}

/** The list pane beside an open request: filters, search and compact request cards. The main pane shows a failure. */
export function PostListPane({
  search,
  onSearch,
  ...props
}: PostListPaneProps) {
  const { t } = useTranslation("quills");
  const [query, setQuery] = useRequestQuery(search.q, (q) => onSearch({ q }));
  const context = {
    statuses: props.statuses,
    boardName: new Map(props.boards.map((board) => [board.id, board.name])),
    anonymous: t("team-posts.anonymous"),
    stale: (months: number) => t("team-posts.stale", { months }),
  };
  return (
    <ListPane
      title={t("team-posts.title")}
      headingLevel={2}
      filters={
        <RequestFilters
          status={search.statusId ? "" : (search.status ?? "active")}
          board={search.board ?? ""}
          sort={search.sort ?? "newest"}
          boards={props.boards}
          onChange={(key, value) => onSearch(filterPatch(key, value))}
        />
      }
      search={{
        label: t("team-posts.search"),
        value: query,
        onChange: setQuery,
      }}
      loading={props.loading}
      empty={!props.posts.length}
    >
      <ul className="grid grid-cols-1 gap-0.5">
        {props.posts.map((post) => (
          <li key={post.id}>
            <RequestRow
              {...postRow(post, context)}
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
