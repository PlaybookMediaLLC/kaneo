import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { getLinkedConversationsForPostFixture } from "../../../api/team/get-linked-conversations-for-post.fixture";
import { listLinksFixture } from "../../../api/team/list-links.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postTeam } from "../post.fixture";
import { PostLinks } from "./post-links";

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
const render = () =>
  renderComponent(
    <RouterContextProvider router={router}>
      <TeamRuntimeProvider value={postTeam}>
        <PostLinks workspaceId="workspace_test_1" postId="post_export" />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );

describe("PostLinks", () => {
  it("shows the tasks of this post and its conversations", async () => {
    const api = mockApi();
    api.reply(
      listLinksFixture.ok({
        posts: [
          { postId: "post_export", taskId: "task_csv" },
          { postId: "post_sso", taskId: "task_sso" },
        ],
      }),
    );
    api.reply(
      getLinkedConversationsForPostFixture.ok({
        items: [
          { conversationId: "conv_1", subject: "CSV please", status: "open" },
          { conversationId: "conv_2", subject: null, status: "closed" },
        ],
      }),
    );
    api.reply({
      id: "task_csv",
      projectId: "project_web",
      title: "Build the CSV export",
    });
    const view = render();
    expect(
      await view.findByRole("link", { name: "Build the CSV export" }),
    ).toBeVisible();
    expect(api.calls()).toHaveLength(3);
    expect(view.getByRole("link", { name: "CSV please" })).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/conversations/conv_1",
    );
    expect(view.getByRole("link", { name: "No subject" })).toBeVisible();
  });

  it("says when nothing is linked and when the links fail", async () => {
    const api = mockApi();
    api.fail();
    api.reply(getLinkedConversationsForPostFixture.ok());
    const view = render();
    expect(await view.findByRole("alert")).toHaveTextContent("went wrong");
    expect(view.getAllByText("None")).toHaveLength(2);
  });
});
