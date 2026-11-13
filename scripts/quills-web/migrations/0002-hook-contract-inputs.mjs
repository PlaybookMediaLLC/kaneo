import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateOperation } from "../lib/generate.mjs";
import { operationNames } from "../lib/naming.mjs";

async function files(directory) {
  try {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await files(path)));
      else if (entry.name.endsWith(".test.tsx")) result.push(path);
    }
    return result;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function migrate(root) {
  const documentText = await readFile(
    join(root, "apps/docs/openapi.json"),
    "utf8",
  );
  const document = JSON.parse(documentText);
  const operations = Object.values(document.paths)
    .flatMap((methods) => Object.values(methods))
    .filter((entry) => entry.operationId);
  const changed = [];
  for (const file of await files(join(root, "apps/web/src/quills/hooks"))) {
    const source = await readFile(file, "utf8");
    if (
      !source.includes("describeHookContract") ||
      source.includes("operationId:")
    )
      continue;
    const oldCall = source.match(
      /describeHookContract\(\{\s*kind:\s*"(query|mutation)",\s*hook:\s*(\w+)\s*\}\)/,
    );
    if (!oldCall) continue;
    const name = file
      .split("/")
      .at(-1)
      .replace(/^use-/, "")
      .replace(/\.test\.tsx$/, "");
    const operation = operations.find(
      (entry) => operationNames(entry.operationId).file === name,
    );
    if (!operation)
      throw new Error(`Unknown generated hook operation: ${file}`);
    const area = file.split("/").at(-2);
    const hook = await readFile(file.replace(/\.test\.tsx$/, ".ts"), "utf8");
    const invalidates = [
      ...hook.matchAll(
        /quillsOperationKey\([^,]+,\s*viewer,\s*"[^"]+",\s*"([^"]+)"\)/g,
      ),
    ].map((match) => {
      const target = operations.find(
        (entry) => operationNames(entry.operationId).name === match[1],
      );
      if (!target)
        throw new Error(`Unknown invalidation operation: ${match[1]}`);
      return target.operationId;
    });
    const temporary = await mkdtemp(join(tmpdir(), "quills-hook-migration-"));
    try {
      await mkdir(join(temporary, "apps/docs"), { recursive: true });
      await writeFile(join(temporary, "apps/docs/openapi.json"), documentText);
      await generateOperation(temporary, oldCall[1], operation.operationId, {
        area,
        invalidates: invalidates.join(","),
      });
      const generated = await readFile(
        join(temporary, relative(root, file)),
        "utf8",
      );
      const newCall = generated.match(
        /describeHookContract\(\{[\s\S]*?\}\)/,
      )?.[0];
      if (!newCall) throw new Error("Generated hook contract was not found");
      const imports = [...generated.matchAll(/^import .+;$/gm)]
        .map((match) => match[0])
        .filter((line) => !source.includes(line));
      await writeFile(
        file,
        imports.join("\n") + "\n" + source.replace(oldCall[0], newCall),
      );
      changed.push(relative(root, file));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return changed;
}
