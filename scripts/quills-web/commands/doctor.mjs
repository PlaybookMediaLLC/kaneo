import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { run as check } from "./check.mjs";
import { renderOperationRoutes } from "../sync-operation-routes.mjs";

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"))
      files.push(path);
  }
  return files;
}

export async function freshnessFindings(root) {
  const findings = [];
  const document = JSON.parse(
    await readFile(`${root}/apps/docs/openapi.json`, "utf8"),
  );
  const manifest = await readFile(
    `${root}/apps/web/src/quills/test/operation-routes.ts`,
    "utf8",
  );
  if (manifest !== renderOperationRoutes(document))
    findings.push(
      "operation-routes.ts is stale; run scripts/quills-web/sync-operation-routes.mjs",
    );
  const routeTree = await readFile(
    `${root}/apps/web/src/routeTree.gen.ts`,
    "utf8",
  );
  for (const directory of ["portal", "quills"]) {
    for (const file of await sourceFiles(
      `${root}/apps/web/src/routes/${directory}`,
    )) {
      const source = await readFile(file, "utf8");
      const route = source.match(/createFileRoute\(("(?:[^"\\]|\\.)*")\)/)?.[1];
      const path = route ? JSON.parse(route) : null;
      if (
        path &&
        !routeTree.includes(`'${path}'`) &&
        !routeTree.includes(`"${path}"`)
      )
        findings.push(`routeTree.gen.ts is stale for ${path}`);
    }
  }
  return findings;
}

export async function run(root, args, options = {}) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error(`Doctor requires Node 24, found ${process.versions.node}`);
  const freshness = await freshnessFindings(root);
  if (freshness.length)
    throw new Error(`Doctor freshness failed:\n${freshness.join("\n")}`);
  const findings = await check(root, args, options);
  if (findings.length) {
    for (const item of findings)
      console.error(`${item.rule} ${item.file}:${item.line} ${item.message}`);
    throw new Error(
      `Doctor failed with ${findings.length} conformance finding(s)`,
    );
  }
  return [];
}
