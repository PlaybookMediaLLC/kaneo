import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

export async function migrations() {
  try {
    return (await readdir(directory))
      .filter((name) => /^\d{4}-.+\.mjs$/.test(name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function runMigrations(root) {
  const changes = [];
  for (const name of await migrations())
    changes.push(
      ...(await (
        await import(pathToFileURL(`${directory}/${name}`).href)
      ).migrate(root)),
    );
  return changes;
}
