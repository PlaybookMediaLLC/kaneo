import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrate } from "./0005-infinite-query-options.mjs";

test("moves existing paged operations to shared infinite query options idempotently", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "quills-infinite-query-migration-"),
  );
  try {
    await mkdir(join(root, "apps/docs"), { recursive: true });
    await mkdir(join(root, "apps/web/src/quills/api/changelog"), {
      recursive: true,
    });
    await mkdir(join(root, "apps/web/src/quills/hooks/changelog"), {
      recursive: true,
    });
    await writeFile(
      join(root, "apps/docs/openapi.json"),
      JSON.stringify({
        paths: {
          "/quills-public/{workspace}/portal/changelog": {
            get: {
              operationId: "listQuillsPortalChangelog",
              parameters: [
                {
                  in: "path",
                  name: "workspace",
                  required: true,
                  schema: { type: "string" },
                },
                { in: "query", name: "offset", schema: { type: "integer" } },
              ],
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          entries: { type: "array", items: { type: "object" } },
                          nextOffset: { type: ["integer", "null"] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    await writeFile(
      join(root, "apps/web/src/quills/api/changelog/list-portal-changelog.ts"),
      `import { queryOptions } from "@tanstack/react-query";
export type ListPortalChangelogRequest = { param: { workspace: string }; query?: { offset?: string } };
export type ListPortalChangelogResponse = { entries: unknown[]; nextOffset: number | null };
export const listPortalChangelogKey = () => ["legacy"] as const;
export async function listPortalChangelog(_input: ListPortalChangelogRequest): Promise<ListPortalChangelogResponse> { return { entries: [], nextOffset: null }; }
export const listPortalChangelogQuery = () => queryOptions({ queryKey: listPortalChangelogKey(), queryFn: () => listPortalChangelog({ param: { workspace: "workspace_test_1" } }) });
`,
    );
    await writeFile(
      join(
        root,
        "apps/web/src/quills/hooks/changelog/use-list-portal-changelog.ts",
      ),
      `import { useInfiniteQuery } from "@tanstack/react-query";
export function useListPortalChangelog(input, viewer) { return useInfiniteQuery({ queryKey: [input, viewer], initialPageParam: 0, queryFn: () => ({ entries: [], nextOffset: null }) }); }
`,
    );
    await writeFile(
      join(
        root,
        "apps/web/src/quills/hooks/changelog/use-list-portal-changelog.test.tsx",
      ),
      `describeHookContract({
  kind: "query",
  hook: useListPortalChangelog,
  operationId: "listQuillsPortalChangelog",
  request: { param: { workspace: "workspace_test_1" } },
  response: { entries: [], nextOffset: null },
  viewer: { kind: "anonymous" },
  invalidates: [],
});
`,
    );
    const changes = await migrate(root);
    assert.deepEqual(changes.sort(), [
      "apps/web/src/quills/api/changelog/list-portal-changelog.ts",
      "apps/web/src/quills/hooks/changelog/use-list-portal-changelog.test.tsx",
      "apps/web/src/quills/hooks/changelog/use-list-portal-changelog.ts",
    ]);
    assert.match(
      await readFile(
        join(
          root,
          "apps/web/src/quills/api/changelog/list-portal-changelog.ts",
        ),
        "utf8",
      ),
      /listPortalChangelogInfiniteQuery/,
    );
    assert.match(
      await readFile(
        join(
          root,
          "apps/web/src/quills/hooks/changelog/use-list-portal-changelog.ts",
        ),
        "utf8",
      ),
      /listPortalChangelogInfiniteQuery\(input, viewer\)/,
    );
    assert.match(
      await readFile(
        join(
          root,
          "apps/web/src/quills/hooks/changelog/use-list-portal-changelog.test.tsx",
        ),
        "utf8",
      ),
      /paged: \{ cursor: 20 \}/,
    );
    assert.deepEqual(await migrate(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
