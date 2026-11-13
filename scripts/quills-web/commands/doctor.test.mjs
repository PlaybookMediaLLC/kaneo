import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { freshnessFindings, run } from "./doctor.mjs";
import { renderOperationRoutes } from "../sync-operation-routes.mjs";

test("doctor command is registered", () =>
  assert.equal(typeof run, "function"));

test("finds stale route and operation manifests", async () => {
  const root = await mkdtemp(`${tmpdir()}/quills-doctor-`);
  await mkdir(`${root}/apps/docs`, { recursive: true });
  await mkdir(`${root}/apps/web/src/quills/test`, { recursive: true });
  await mkdir(`${root}/apps/web/src/routes/portal`, { recursive: true });
  await mkdir(`${root}/apps/web/src/routes/quills`, { recursive: true });
  const document = {
    paths: {
      "/quills-public/{workspace}/status": {
        get: { operationId: "getQuillsPublicStatusPage", tags: ["Quills"] },
      },
    },
  };
  await writeFile(`${root}/apps/docs/openapi.json`, JSON.stringify(document));
  await writeFile(
    `${root}/apps/web/src/quills/test/operation-routes.ts`,
    "stale",
  );
  await writeFile(`${root}/apps/web/src/routeTree.gen.ts`, "stale");
  await writeFile(
    `${root}/apps/web/src/routes/portal/status.tsx`,
    'createFileRoute("/portal/$workspaceId/status")({});',
  );
  assert.deepEqual(await freshnessFindings(root), [
    "operation-routes.ts is stale; run scripts/quills-web/sync-operation-routes.mjs",
    "routeTree.gen.ts is stale for /portal/$workspaceId/status",
  ]);
  await writeFile(
    `${root}/apps/web/src/quills/test/operation-routes.ts`,
    renderOperationRoutes(document),
  );
  await writeFile(
    `${root}/apps/web/src/routeTree.gen.ts`,
    "'/portal/$workspaceId/status'",
  );
  assert.deepEqual(await freshnessFindings(root), []);
});
