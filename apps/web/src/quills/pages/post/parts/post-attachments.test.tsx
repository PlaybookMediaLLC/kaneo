import { expect, it } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/render";
import { mockApi } from "../../../test/mock-api";
import { getPortalFileFixture } from "../../../api/files/get-portal-file.fixture";
import { PostAttachments } from "./post-attachments";
it("authorizes downloads when opened and displays an image preview", async () => {
  const api = mockApi();
  api.reply(
    getPortalFileFixture.ok({
      id: "file_1",
      name: "example.png",
      contentType: "image/png",
      downloadUrl: "https://storage.example.test/image.png",
    }),
  );
  const view = renderComponent(
    <PostAttachments
      workspaceId="workspace_test_1"
      viewer={{ kind: "anonymous" }}
      attachments={[
        {
          id: "file_1",
          name: "example.png",
          contentType: "image/png",
          size: 12,
        },
      ]}
    />,
  );
  expect(api.calls()).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Open example.png" }));
  expect(await view.findByRole("img", { name: "example.png" })).toHaveAttribute(
    "src",
    "https://storage.example.test/image.png",
  );
  expect(view.getByRole("link", { name: "Download" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
});
