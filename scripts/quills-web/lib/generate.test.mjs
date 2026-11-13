import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateOperation, generatePage } from "./generate.mjs";

test("generates both pagination contracts from the real API schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-pagination-test-"));
  try {
    await mkdir(join(root, "apps/docs"), { recursive: true });
    await mkdir(join(root, "apps/api/src/quills/portal"), { recursive: true });
    await copyFile(
      resolve(import.meta.dirname, "../../../apps/docs/openapi.json"),
      join(root, "apps/docs/openapi.json"),
    );
    await copyFile(
      resolve(
        import.meta.dirname,
        "../../../apps/api/src/quills/portal/paths.ts",
      ),
      join(root, "apps/api/src/quills/portal/paths.ts"),
    );
    for (const [id, file, parameter, field] of [
      [
        "listQuillsPortalChangelog",
        "list-portal-changelog",
        "offset",
        "nextOffset",
      ],
      [
        "listQuillsPublicStatusHistory",
        "list-public-status-history",
        "cursor",
        "nextCursor",
      ],
    ]) {
      await generateOperation(root, "query", id, {
        area: "content",
        paged: true,
      });
      const hook = await readFile(
        join(root, `apps/web/src/quills/hooks/content/use-${file}.ts`),
        "utf8",
      );
      const operation = await readFile(
        join(root, `apps/web/src/quills/api/content/${file}.ts`),
        "utf8",
      );
      assert.ok(
        operation.includes(
          `${parameter}: ${parameter === "offset" ? "String(pageParam)" : "pageParam"}`,
        ),
      );
      assert.ok(operation.includes(`lastPage.${field} ?? undefined`));
      assert.match(operation, /infiniteQueryOptions</);
      assert.match(hook, /InfiniteQuery\(input, viewer\)/);
      assert.doesNotMatch(operation, /as \w+Request/);
    }
    await generateOperation(root, "query", "getQuillsPublicHelpCenterArticle", {
      area: "content",
    });
    const article = await readFile(
      join(
        root,
        "apps/web/src/quills/api/content/get-public-help-center-article.fixture.ts",
      ),
      "utf8",
    );
    assert.match(article, /article:\s*\{/);
    assert.doesNotMatch(article, /article:\s*"value"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid page input before writing any page file", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-page-validation-"));
  try {
    await mkdir(join(root, "apps/docs"), { recursive: true });
    await mkdir(join(root, "apps/api/src/quills/portal"), { recursive: true });
    await mkdir(join(root, "apps/web/src/quills/i18n/en-US"), {
      recursive: true,
    });
    await copyFile(
      resolve(import.meta.dirname, "../../../apps/docs/openapi.json"),
      join(root, "apps/docs/openapi.json"),
    );
    await copyFile(
      resolve(
        import.meta.dirname,
        "../../../apps/api/src/quills/portal/paths.ts",
      ),
      join(root, "apps/api/src/quills/portal/paths.ts"),
    );
    await writeFile(
      join(root, "apps/web/src/quills/i18n/en-US/sample.json"),
      '{"title":"Sample"}\n',
    );
    await assert.rejects(
      () =>
        generatePage(root, "sample", {
          route: "/portal/$workspaceId/sample",
          audience: "public",
          feature: "sample",
          search: "bad:object",
          operations: "getQuillsPublicPortalConfig",
        }),
      /Invalid --search field/,
    );
    await assert.rejects(
      () => readFile(join(root, "apps/web/src/quills/pages/sample/meta.ts")),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates registered parent pages as index routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-parent-route-"));
  try {
    await mkdir(join(root, "apps/docs"), { recursive: true });
    await mkdir(join(root, "apps/api/src/quills/portal"), { recursive: true });
    await mkdir(join(root, "apps/web/src/quills/i18n/en-US"), {
      recursive: true,
    });
    await copyFile(
      resolve(import.meta.dirname, "../../../apps/docs/openapi.json"),
      join(root, "apps/docs/openapi.json"),
    );
    await copyFile(
      resolve(
        import.meta.dirname,
        "../../../apps/api/src/quills/portal/paths.ts",
      ),
      join(root, "apps/api/src/quills/portal/paths.ts"),
    );
    await writeFile(
      join(root, "apps/web/src/quills/i18n/en-US/changelog-parent.json"),
      '{"title":"Changelog"}\n',
    );
    await generateOperation(root, "query", "listQuillsPortalChangelog", {
      area: "changelog-parent",
      paged: true,
    });
    await generatePage(root, "changelog-parent", {
      route: "/portal/$workspaceId/changelog",
      audience: "public",
      feature: "changelog-parent",
      operations: "listQuillsPortalChangelog",
    });
    const route = await readFile(
      join(root, "apps/web/src/routes/portal/$workspaceId/changelog/index.tsx"),
      "utf8",
    );
    assert.match(
      route,
      /createFileRoute\("\/portal\/\$workspaceId\/changelog\/"\)/,
    );
    await assert.rejects(
      () =>
        readFile(
          join(root, "apps/web/src/routes/portal/$workspaceId/changelog.tsx"),
        ),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
