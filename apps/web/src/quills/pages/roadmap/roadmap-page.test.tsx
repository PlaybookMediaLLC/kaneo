import { describe, expect } from "vite-plus/test";
import { getPortalPostFixture } from "../../api/feedback/get-portal-post.fixture";
import { listPortalBoardsFixture } from "../../api/feedback/list-portal-boards.fixture";
import { listPortalPostsFixture } from "../../api/feedback/list-portal-posts.fixture";
import { listPortalStatusesFixture } from "../../api/feedback/list-portal-statuses.fixture";
import { setPortalVoteFixture } from "../../api/feedback/set-portal-vote.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { meta } from "./meta";
import { RoadmapPage } from "./roadmap-page";

const status = {
  id: "post_status_test_1",
  name: "Planned",
  slug: "planned",
  color: "blue",
  category: "active",
  showOnRoadmap: true,
  stage: "planned" as const,
};
const statuses = [
  status,
  {
    ...status,
    id: "post_status_test_2",
    name: "Building",
    slug: "in_progress",
    showOnRoadmap: false,
    stage: "in_progress" as const,
  },
];
const board = {
  id: "board_test_1",
  name: "Ideas",
  slug: "ideas",
  description: null,
  postCount: null,
  canSubmit: true,
  canVote: true,
  canComment: true,
};
const post = getPortalPostFixture.ok({
  id: "post_test_1",
  title: "Linear sync",
  board: { id: "board_test_1", name: "Ideas", slug: "ideas" },
  stage: "planned",
});

function prepare() {
  const api = mockApi();
  api.reply(listPortalStatusesFixture.ok({ items: statuses }));
  api.reply(listPortalBoardsFixture.ok({ items: [board] }));
  api.reply(listPortalPostsFixture.ok({ items: [post] }));
  return api;
}

describe("RoadmapPage", () => {
  describePageContract(meta, RoadmapPage, {
    loading: { prepare: () => void mockApi().defer(() => undefined) },
    failed: { prepare: () => void mockApi().fail() },
    ready: {
      prepare: () => void prepare(),
      assert: async (view) => {
        await view.findByRole("link", { name: "Linear sync" });
        expect(
          view.getByRole("heading", { level: 2, name: /Planned/ }),
        ).toBeInTheDocument();
        expect(
          view.queryByRole("heading", { level: 2, name: /Building/ }),
        ).not.toBeInTheDocument();
      },
    },
    done: {
      prepare: () => {
        const api = prepare();
        api.reply(setPortalVoteFixture.ok({ postId: post.id, voted: true }));
        api.reply(
          listPortalPostsFixture.ok({ items: [{ ...post, voted: true }] }),
        );
        return { viewer: { kind: "user" as const, id: "account_test_1" } };
      },
      act: async (view) => {
        await view.findByRole("link", { name: "Linear sync" });
        press("Vote");
        await view.findByRole("button", { name: "Remove vote" });
      },
    },
  });
});
