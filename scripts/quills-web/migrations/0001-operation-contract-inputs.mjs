import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

async function tests(path) {
  try {
    const output = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) output.push(...(await tests(child)));
      else if (entry.name.endsWith(".test.ts")) output.push(child);
    }
    return output;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function sample(name, schema = {}) {
  if (schema.enum) return schema.enum[0];
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 1;
  if (name === "workspace" || name === "workspaceId") return "workspace_test_1";
  if (name.toLowerCase().includes("token")) return "mail_link_value";
  if (name.toLowerCase().endsWith("id")) return `${name.toLowerCase()}_test_1`;
  return "value";
}

export async function migrate(root) {
  const document = JSON.parse(
    await readFile(`${root}/apps/docs/openapi.json`, "utf8"),
  );
  const changed = [];
  for (const file of await tests(`${root}/apps/web/src/quills/api`)) {
    const old = await readFile(file, "utf8");
    if (!old.includes("describeOperationContract") || old.includes("statuses:"))
      continue;
    const operationId = old.match(/operationId:\s*["']([^"']+)/)?.[1];
    const fn = old.match(/operation:\s*(\w+)/)?.[1];
    if (!operationId || !fn) continue;
    let found;
    for (const [path, methods] of Object.entries(document.paths ?? {}))
      for (const [method, operation] of Object.entries(methods))
        if (operation.operationId === operationId)
          found = { path, method, operation };
    if (!found) continue;
    const request = { param: {}, query: {} };
    for (const name of [...found.path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    ))
      request.param[name] = sample(name);
    for (const parameter of found.operation.parameters ?? [])
      if (parameter.in === "query" && parameter.required)
        request.query[parameter.name] = sample(
          parameter.name,
          parameter.schema,
        );
    if (!Object.keys(request.query).length) delete request.query;
    const path = `/api${found.path.replace(/\{([^}]+)\}/g, (_match, name) => encodeURIComponent(request.param[name]))}`;
    const statuses = Object.keys(found.operation.responses ?? {})
      .filter((status) => /^[45]\d\d$/.test(status))
      .map(Number);
    const source = old
      .replace(`import { ${fn} }`, `import { ${fn} }`)
      .replace(
        /(import \{ \w+ \} from "\.\/[^";]+";)/,
        `$1\nimport { ${fn}Fixture } from "./${file.split("/").at(-1).replace(".test.ts", ".fixture")}";`,
      )
      .replace(
        /describeOperationContract\(\{[\s\S]*?\}\);/,
        `describeOperationContract({ operationId: ${JSON.stringify(operationId)}, operation: ${fn}, request: ${JSON.stringify(request)}, response: ${fn}Fixture.ok(), method: ${JSON.stringify(found.method)}, path: ${JSON.stringify(path)}, statuses: ${JSON.stringify(statuses)} });`,
      );
    await writeFile(file, source);
    changed.push(relative(root, file));
  }
  return changed;
}
