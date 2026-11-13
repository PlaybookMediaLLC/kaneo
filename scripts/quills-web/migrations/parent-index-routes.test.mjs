import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrate } from "./0004-parent-index-routes.mjs";

test("moves parent pages and adjacent tests to idempotent index routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-parent-index-migration-"));
  try {
    const base = join(
      root,
      "apps/web/src/routes/portal/$workspaceId/changelog",
    );
    await mkdir(join(root, "apps/web/src/routes/portal/$workspaceId"), {
      recursive: true,
    });
    await writeFile(
      `${base}.tsx`,
      'export const Route = createFileRoute("/portal/$workspaceId/changelog")({});\n',
    );
    await writeFile(`${base}.test.tsx`, 'import "./changelog";\n');
    assert.deepEqual(await migrate(root), [
      "apps/web/src/routes/portal/$workspaceId/changelog/index.tsx",
      "apps/web/src/routes/portal/$workspaceId/changelog/index.test.tsx",
    ]);
    assert.match(
      await readFile(join(base, "index.tsx"), "utf8"),
      /createFileRoute\("\/portal\/\$workspaceId\/changelog\/"\)/,
    );
    assert.equal(
      await readFile(join(base, "index.test.tsx"), "utf8"),
      'import "./index";\n',
    );
    assert.deepEqual(await migrate(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
