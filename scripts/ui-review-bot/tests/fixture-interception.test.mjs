import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { intercept } from "@kaneo/browser-test";

test("fixture failures block requests and remain visible; cancelled requests are harmless", async () => {
  for (const message of ["fixture failed", "Invalid InterceptionId."]) {
    let paused;
    const commands = [];
    const session = {
      on(_event, listener) {
        paused = listener;
      },
      async send(method) {
        commands.push(method);
      },
    };
    const diagnostics = { errors: [] };
    await intercept(
      { monitor: () => ({ session }) },
      {},
      () => {
        throw new Error(message);
      },
      diagnostics,
    );
    paused({
      requestId: "request",
      request: { url: "http://localhost/api/test" },
    });
    await setImmediate();
    assert.deepEqual(
      diagnostics.errors,
      message === "fixture failed"
        ? ["Fixture interception: fixture failed"]
        : [],
    );
    assert.equal(
      commands.includes("Fetch.failRequest"),
      message === "fixture failed",
    );
    assert.ok(!commands.includes("Fetch.continueRequest"));
  }
});
