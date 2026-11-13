import { describe, expect, it } from "vite-plus/test";
import { runMutation } from "./run-mutation";
describe("runMutation", () => {
  it("returns no problem on success and preserves structured failures", async () => {
    await expect(runMutation(async () => 42)).resolves.toBeUndefined();
    const problem = { kind: "rateLimited", retryAt: 123 };
    await expect(
      runMutation(async () => {
        throw problem;
      }),
    ).resolves.toBe(problem);
  });
});
