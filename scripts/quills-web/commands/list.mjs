import { readdir, readFile } from "node:fs/promises";

async function files(path) {
  try {
    const output = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      output.push(...(entry.isDirectory() ? await files(child) : [child]));
    }
    return output;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function run(root, _args, options = {}) {
  const output = [];
  for (const file of await files(`${root}/apps/web/src/quills`)) {
    const name = file.slice(root.length + 1);
    if (options.exceptions) {
      const text = await readFile(file, "utf8");
      for (const [index, line] of text.split("\n").entries())
        if (line.includes("quills-web-allow"))
          output.push(`${name}:${index + 1} ${line.trim()}`);
    } else if (!options.kind || name.includes(`/${options.kind}`))
      output.push(name);
  }
  return output;
}
