import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

test("browser tooling is pinned and contains no retired browser driver or cloud SDK", async () => {
  const packageFile = new URL(
    "../../../scripts/browser-test/package.json",
    import.meta.url,
  );
  const dependencies = JSON.parse(
    await readFile(packageFile, "utf8"),
  ).dependencies;
  assert.equal(dependencies["@browserbasehq/stagehand"], "4.4.0");
  const lock = await readFile(
    new URL("../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    lock,
    /(?:playwright|browserstack-node-sdk|basic-ftp|http-cache-semantics)@/,
  );
  const require = createRequire(new URL("../package.json", import.meta.url));
  assert.ok(require.resolve("@kaneo/browser-test"));
});
