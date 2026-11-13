import { describe, expect, it } from "vite-plus/test";
import { mockApi } from "./mock-api";

describe("mockApi", () => {
  it("fails an unprepared request", async () => {
    mockApi();
    await expect(fetch("http://example.test/unprepared")).rejects.toThrow(
      "Unexpected API request",
    );
  });

  it("finds requests by their OpenAPI operation ID", async () => {
    const api = mockApi();
    api.reply({});
    await fetch(
      "http://example.test/api/quills-public/workspace_test_1/portal/config",
    );
    expect(api.calls("getQuillsPublicPortalConfig")).toHaveLength(1);
  });

  it("holds a deferred request until the test rejects it", async () => {
    const api = mockApi();
    let rejectRequest!: (error: Error) => void;
    api.defer(({ reject }) => {
      rejectRequest = reject;
    });
    const request = fetch("http://example.test/deferred");
    await Promise.resolve();
    expect(api.calls()).toHaveLength(1);
    rejectRequest(new Error("Request stopped"));
    await expect(request).rejects.toThrow("Request stopped");
  });
});
