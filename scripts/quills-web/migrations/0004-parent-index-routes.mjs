import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const parents = [
  "/portal/$workspaceId/changelog",
  "/portal/$workspaceId/hc",
  "/portal/$workspaceId/hc/$locale",
  "/portal/$workspaceId/status",
  "/portal/$workspaceId/support",
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function migrate(root) {
  const changed = [];
  for (const route of parents) {
    const base = join(root, "apps/web/src/routes", route.slice(1));
    const target = join(base, "index.tsx");
    if (await exists(`${base}.tsx`)) {
      if (await exists(target))
        throw new Error(
          `Both parent route shapes exist: ${relative(root, base)}`,
        );
      const source = await readFile(`${base}.tsx`, "utf8");
      const updated = source.replace(
        `createFileRoute(${JSON.stringify(route)})`,
        `createFileRoute(${JSON.stringify(`${route}/`)})`,
      );
      if (updated === source)
        throw new Error(
          `Parent route ID was not found: ${relative(root, `${base}.tsx`)}`,
        );
      await mkdir(dirname(target), { recursive: true });
      await rename(`${base}.tsx`, target);
      await writeFile(target, updated);
      changed.push(relative(root, target));
    }
    const oldTest = `${base}.test.tsx`;
    const newTest = join(base, "index.test.tsx");
    if (await exists(oldTest)) {
      if (await exists(newTest))
        throw new Error(
          `Both parent route test shapes exist: ${relative(root, base)}`,
        );
      const testSource = await readFile(oldTest, "utf8");
      const fileName = base.split("/").at(-1);
      const updatedTest = testSource.replaceAll(`./${fileName}`, "./index");
      await mkdir(dirname(newTest), { recursive: true });
      await rename(oldTest, newTest);
      await writeFile(newTest, updatedTest);
      changed.push(relative(root, newTest));
    }
  }
  return changed;
}
