import { describe, expect, it } from "vite-plus/test";
import { toPortalProblem } from "./errors";

describe("toPortalProblem", () => {
  it("maps documented validation errors to field issues", async () => {
    const issues = [{ path: "title", message: "Enter a title" }];
    await expect(
      toPortalProblem(
        new Response(
          JSON.stringify({
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            issues,
          }),
          { status: 400 },
        ),
      ),
    ).resolves.toEqual({ kind: "invalid", issues });
    await expect(
      toPortalProblem(new Response("Bad request", { status: 400 })),
    ).resolves.toEqual({ kind: "failed" });
  });
  it("hides a denied record as not found", async () => {
    await expect(
      toPortalProblem(new Response("denied", { status: 403 })),
    ).resolves.toEqual({ kind: "notFound" });
  });
  it("shows a teammate 403 as a denied action", async () => {
    await expect(
      toPortalProblem(new Response("denied", { status: 403 }), "teammate"),
    ).resolves.toEqual({ kind: "noAccess" });
  });
  it("does not return a server response message", async () => {
    await expect(
      toPortalProblem(new Response("private details", { status: 500 })),
    ).resolves.toEqual({ kind: "failed" });
  });
  it("retains a safe retry deadline for rate limits without server text", async () => {
    const before = Date.now();
    const problem = await toPortalProblem(
      new Response("private details", {
        status: 429,
        headers: { "retry-after": "3" },
      }),
    );
    expect(problem.kind).toBe("rateLimited");
    expect(problem.retryAt).toBeGreaterThanOrEqual(before + 3000);
    expect(problem.retryAt).toBeLessThanOrEqual(Date.now() + 3000);
    expect(problem).not.toHaveProperty("message");
  });
});
