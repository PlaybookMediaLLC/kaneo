import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vite-plus/test";
import { quillsKey, quillsOperationKey } from "./keys";

describe("Quills keys", () => {
  it("scopes data to workspace and viewer", () => {
    expect(
      quillsKey("workspace_1", { kind: "user", id: "user_1" }, "posts", "list"),
    ).toContain("user_1");
  });

  it("invalidates every input variant of one real operation key", async () => {
    const client = new QueryClient();
    const viewer = { kind: "user", id: "user_1" } as const;
    const fullKey = quillsKey(
      "workspace_1",
      viewer,
      "notifications",
      "previewUnsubscribeToken",
      {
        param: { workspace: "workspace_1" },
        query: { token: "mail_link_value" },
      },
    );
    client.setQueryData(fullKey, { subscribed: true });
    await client.invalidateQueries({
      queryKey: quillsOperationKey(
        "workspace_1",
        viewer,
        "notifications",
        "previewUnsubscribeToken",
      ),
    });
    expect(client.getQueryState(fullKey)?.isInvalidated).toBe(true);
  });
});
