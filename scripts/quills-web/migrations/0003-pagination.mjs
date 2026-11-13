import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { operationNames } from "../lib/naming.mjs";
import { resolveSchema } from "../lib/openapi.mjs";

async function files(directory) {
  try {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await files(path)));
      else if (entry.name.endsWith(".ts")) result.push(path);
    }
    return result;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function migrate(root) {
  const document = JSON.parse(
    await readFile(join(root, "apps/docs/openapi.json"), "utf8"),
  );
  const operations = Object.values(document.paths)
    .flatMap((methods) => Object.values(methods))
    .filter((entry) => entry.operationId);
  const changed = [];
  for (const file of await files(join(root, "apps/web/src/quills/hooks"))) {
    const source = await readFile(file, "utf8");
    if (!source.includes('"nextCursor" in lastPage')) continue;
    const name = file
      .split("/")
      .at(-1)
      .replace(/^use-/, "")
      .replace(/\.ts$/, "");
    const operation = operations.find(
      (entry) => operationNames(entry.operationId).file === name,
    );
    if (!operation) throw new Error(`Unknown paged operation: ${file}`);
    const names = operationNames(operation.operationId);
    const response = Object.entries(operation.responses).find(([status]) =>
      /^2\d\d$/.test(status),
    )?.[1];
    const properties =
      resolveSchema(document, response?.content?.["application/json"]?.schema)
        .properties ?? {};
    const offset = Boolean(
      properties.nextOffset &&
      operation.parameters?.some(
        (p) => p.in === "query" && p.name === "offset",
      ),
    );
    if (!offset && !properties.nextCursor)
      throw new Error(`No declared pagination cursor: ${file}`);
    const updated = source
      .replace(
        "import { useInfiniteQuery }",
        "import { useInfiniteQuery, type InfiniteData }",
      )
      .replace(
        `type ${names.pascal}Request }`,
        `type ${names.pascal}Request, type ${names.pascal}Response }`,
      )
      .replace(
        `useInfiniteQuery<${names.pascal}Response, PortalProblem>`,
        `useInfiniteQuery<${names.pascal}Response, PortalProblem, InfiniteData<${names.pascal}Response>, ReturnType<typeof ${names.name}Key>, ${offset ? "number" : "string | undefined"}>`,
      )
      .replace(
        "initialPageParam: undefined as string | undefined",
        `initialPageParam: ${offset ? "0" : "undefined"}`,
      )
      .replace(
        "cursor: pageParam",
        `${offset ? "offset: String(pageParam)" : "cursor: pageParam"}`,
      )
      .replace(`} as ${names.pascal}Request)`, "})")
      .replace(
        '"nextCursor" in lastPage ? lastPage.nextCursor as string | undefined : undefined',
        `lastPage.${offset ? "nextOffset" : "nextCursor"} ?? undefined`,
      );
    await writeFile(file, updated);
    changed.push(relative(root, file));
  }
  return changed;
}
