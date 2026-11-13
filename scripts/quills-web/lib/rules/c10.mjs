import { operationNames } from "../naming.mjs";
import { exportedNames, pascal } from "./ast.mjs";
export function check({ documents, operations, report }) {
  const known = [...operations].map(([id, operation]) => ({
    ...operationNames(id),
    method: operation.method,
  }));
  for (const d of documents) {
    const filename = d.file.split("/").at(-1),
      stem = filename.replace(/\.(?:test\.)?tsx?$/, "");
    const names = exportedNames(d.ast ?? {});
    if (
      ["page", "component", "part", "form"].includes(d.kind) &&
      !names.includes(pascal(stem))
    )
      report("C10", d, 1, `Export ${pascal(stem)} from ${filename}.`);
    if (
      d.kind === "hook" &&
      (!stem.startsWith("use-") ||
        !names.includes(`use${pascal(stem.slice(4))}`))
    )
      report(
        "C10",
        d,
        1,
        "Match the hook export and use-<operation> filename.",
      );
    if (["operation", "fixture"].includes(d.kind)) {
      const operation = known.find(
        (o) => o.file === stem.replace(/\.fixture$/, ""),
      );
      if (operation) {
        const required =
          d.kind === "fixture"
            ? [`${operation.name}Fixture`]
            : [
                operation.name,
                `${operation.pascal}Request`,
                `${operation.pascal}Response`,
                `${operation.name}Key`,
                ...(operation.method === "get"
                  ? [`${operation.name}Query`]
                  : []),
              ];
        for (const name of required)
          if (!names.includes(name))
            report("C10", d, 1, `Export the generated ${name} name.`);
      }
    }
    if (d.kind === "meta" && d.meta?.id !== d.file.split("/").at(-2))
      report("C10", d, 1, "The page folder and metadata ID must match.");
  }
}
