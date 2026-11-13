import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bundledTemplates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);

export async function renderTemplate(root, name, values) {
  let output;
  try {
    output = await readFile(
      `${root}/scripts/quills-web/templates/${name}`,
      "utf8",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    output = await readFile(join(bundledTemplates, name), "utf8");
  }
  for (const [key, value] of Object.entries(values))
    output = output.replaceAll(`{{${key}}}`, String(value));
  const unresolved = [...output.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(
    (match) => match[1],
  );
  if (unresolved.length)
    throw new Error(
      `Template ${name} has unresolved values: ${[...new Set(unresolved)].join(", ")}`,
    );
  return output;
}
