import { describe, expect, it } from "vite-plus/test";
import { quillsKey } from "../api/keys";
import { isOtherQuillsScope } from "./team-cache";

const user = { kind: "user", id: "user_1" } as const;

describe("isOtherQuillsScope", () => {
  it("keeps the current workspace and user", () => {
    expect(
      isOtherQuillsScope(
        quillsKey("workspace_1", user, "team", "fetchAdminOverview"),
        "workspace_1",
        "user_1",
      ),
    ).toBe(false);
  });

  it("selects another workspace, another user and anonymous data", () => {
    for (const key of [
      quillsKey("workspace_2", user, "team", "fetchAdminOverview"),
      quillsKey(
        "workspace_1",
        { kind: "user", id: "user_2" },
        "team",
        "listBoards",
      ),
      quillsKey("workspace_1", { kind: "anonymous" }, "portal", "config"),
    ])
      expect(isOtherQuillsScope(key, "workspace_1", "user_1")).toBe(true);
  });

  it("leaves Kaneo and older Quills keys alone", () => {
    expect(
      isOtherQuillsScope(
        ["quills-context", "user_2", "workspace_2"],
        "workspace_1",
        "user_1",
      ),
    ).toBe(false);
    expect(isOtherQuillsScope(["projects"], "workspace_1", "user_1")).toBe(
      false,
    );
  });
});
