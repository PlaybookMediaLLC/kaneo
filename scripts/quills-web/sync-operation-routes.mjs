#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function operationRoutes(document) {
  const routes = [];
  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.operationId || !operation.tags?.includes("Quills"))
        continue;
      routes.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path: `/api${path}`,
      });
    }
  }
  return routes.sort((left, right) =>
    left.operationId.localeCompare(right.operationId),
  );
}

export function renderOperationRoutes(document) {
  return `// Generated from apps/docs/openapi.json by scripts/quills-web/sync-operation-routes.mjs.\nexport const quillsOperationRoutes = ${JSON.stringify(operationRoutes(document), null, 2)} as const;\n`;
}

export async function syncOperationRoutes(root) {
  const document = JSON.parse(
    await readFile(`${root}/apps/docs/openapi.json`, "utf8"),
  );
  const output = renderOperationRoutes(document);
  await writeFile(
    `${root}/apps/web/src/quills/test/operation-routes.ts`,
    output,
  );
  return operationRoutes(document).length;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  console.log(
    `WROTE ${await syncOperationRoutes(root)} Quills operation routes`,
  );
}
