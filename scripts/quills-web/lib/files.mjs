import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The teammate folder of RFC 0002 D24, inside the upstream workspace layout.
export const teamRoutes =
  "apps/web/src/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/quills";
const owned = [
  "apps/web/src/quills/",
  "apps/web/src/routes/portal/",
  "apps/web/src/routes/quills/",
  `${teamRoutes}/`,
  "scripts/quills-web/",
];
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function assertNewPaths(root, paths) {
  for (const path of paths) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (!owned.some((prefix) => name.startsWith(prefix)))
      throw new Error(`Refusing to write outside a fork-owned path: ${name}`);
    try {
      await access(path);
      throw new Error(`Refusing to overwrite existing file: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function writeNew(root, path, content) {
  const name = relative(root, path).replaceAll("\\", "/");
  if (!owned.some((prefix) => name.startsWith(prefix)))
    throw new Error(`Refusing to write outside a fork-owned path: ${name}`);
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing file: ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (process.env.QUILLS_WEB_DRY_RUN === "1") return name;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`);
  return name;
}

export async function addSortedJsonKeys(root, path, additions) {
  const name = relative(root, path).replaceAll("\\", "/");
  if (!owned.some((prefix) => name.startsWith(prefix)))
    throw new Error(`Refusing to write outside a fork-owned path: ${name}`);
  const current = JSON.parse(await readFile(path, "utf8"));
  const merged = Object.fromEntries(
    Object.entries({ ...current, ...additions }).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  if (process.env.QUILLS_WEB_DRY_RUN !== "1")
    await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`);
  return name;
}

export function formatGenerated(paths) {
  if (process.env.QUILLS_WEB_DRY_RUN === "1" || paths.length === 0) return;
  const result = spawnSync(
    resolve(repository, "node_modules/.bin/vp"),
    ["check", "--fix", ...paths],
    { cwd: repository, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Generated formatting failed:\n${result.stdout}${result.stderr}`,
    );
}
