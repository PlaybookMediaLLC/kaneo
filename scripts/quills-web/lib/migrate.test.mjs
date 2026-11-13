import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../migrations/0002-hook-contract-inputs.mjs";
import { migrate as migratePagination } from "../migrations/0003-pagination.mjs";

test("upgrades legacy hook contracts once and retains authored behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-migration-test-"));
  try {
    await mkdir(join(root, "apps/docs"), { recursive: true });
    const schema = {
      type: "object",
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    };
    await writeFile(
      join(root, "apps/docs/openapi.json"),
      JSON.stringify({
        paths: {
          "/quills-public/{workspace}/items": {
            get: {
              operationId: "listQuillsItems",
              responses: {
                200: { content: { "application/json": { schema } } },
              },
            },
          },
        },
      }),
    );
    const folder = join(root, "apps/web/src/quills/hooks/items");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "use-list-items.ts"),
      "export function useListItems() {}\n",
    );
    const file = join(folder, "use-list-items.test.tsx");
    await writeFile(
      file,
      'import { describeHookContract } from "../../test/contracts";\nimport { useListItems } from "./use-list-items";\ndescribeHookContract({ kind: "query", hook: useListItems });\n// Authored behavior stays.\n',
    );
    assert.equal((await migrate(root)).length, 1);
    const upgraded = await readFile(file, "utf8");
    assert.match(upgraded, /operationId: "listQuillsItems"/);
    assert.match(upgraded, /emptyRequest:/);
    assert.match(upgraded, /Authored behavior stays/);
    assert.deepEqual(await migrate(root), []);
    assert.equal(await readFile(file, "utf8"), upgraded);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upgrades cursor and offset hooks once without losing polling", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-pagination-migration-"));
  try {
    await mkdir(join(root, "apps/docs"), { recursive: true });
    const paths = {};
    for (const kind of ["offset", "cursor"]) {
      paths[`/quills-public/{workspace}/${kind}`] = {
        get: {
          operationId: `listQuills${kind === "offset" ? "Offset" : "Cursor"}`,
          parameters: [
            {
              in: "query",
              name: kind,
              schema: { type: kind === "offset" ? "integer" : "string" },
            },
          ],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      [kind === "offset" ? "nextOffset" : "nextCursor"]: {
                        type: kind === "offset" ? "integer" : "string",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const name = kind === "offset" ? "ListOffset" : "ListCursor";
      const folder = join(root, "apps/web/src/quills/hooks/items");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, `use-list-${kind}.ts`),
        `import { useInfiniteQuery } from "@tanstack/react-query";
import { type ${name}Request } from "../../api/items/list-${kind}";
export function use${name}() {
  return useInfiniteQuery<${name}Response, PortalProblem>({
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => request({ query: { cursor: pageParam } } as ${name}Request),
    getNextPageParam: (lastPage) => "nextCursor" in lastPage ? lastPage.nextCursor as string | undefined : undefined,
    refetchInterval: 30000,
  });
}`,
      );
    }
    await writeFile(
      join(root, "apps/docs/openapi.json"),
      JSON.stringify({ paths }),
    );
    assert.equal((await migratePagination(root)).length, 2);
    const offset = await readFile(
      join(root, "apps/web/src/quills/hooks/items/use-list-offset.ts"),
      "utf8",
    );
    assert.match(offset, /offset: String\(pageParam\)/);
    assert.match(offset, /lastPage.nextOffset \?\? undefined/);
    assert.match(offset, /refetchInterval: 30000/);
    assert.match(offset, /type ListOffsetResponse/);
    assert.doesNotMatch(offset, /as ListOffsetRequest/);
    assert.deepEqual(await migratePagination(root), []);
    assert.equal(
      await readFile(
        join(root, "apps/web/src/quills/hooks/items/use-list-offset.ts"),
        "utf8",
      ),
      offset,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
