import { imports, exportedNames, kebab, nameOf } from "./ast.mjs";
export function check({ documents, operations, report }) {
  for (const d of documents)
    for (const { node } of d.nodes) {
      if (
        node.type === "Property" &&
        node.key?.name === "operationId" &&
        typeof node.value?.value === "string" &&
        !operations.has(node.value.value)
      )
        report(
          "C11",
          d,
          node,
          `Unknown OpenAPI operation ${node.value.value}.`,
        );
    }
  const byName = new Map(
    [...operations].map(([id, op]) => [id.replace("Quills", ""), { id, op }]),
  );
  for (const d of documents.filter((d) => d.kind === "operation")) {
    const fn = exportedNames(d.ast).find((n) => byName.has(n));
    if (!fn || !d.file.endsWith(`/${kebab(fn)}.ts`))
      report("C11", d, 1, "Use the generated operation ID/name from OpenAPI.");
  }
  for (const meta of documents.filter((d) => d.kind === "meta")) {
    const folder = meta.file.slice(0, -7);
    const pageSources = documents.filter(
      (d) =>
        d.file.startsWith(folder) && ["page", "part", "form"].includes(d.kind),
    );
    for (const id of meta.meta?.operations ?? []) {
      if (!operations.has(id)) {
        report("C11", meta, 1, `Unknown OpenAPI operation ${id}.`);
        continue;
      }
      const hook = `use${id.replace("Quills", "").replace(/^./, (c) => c.toUpperCase())}`;
      if (
        !pageSources.some(
          (d) =>
            imports(d).some((i) => i.imported.includes(hook)) &&
            d.nodes.some(
              ({ node }) =>
                node.type === "CallExpression" && nameOf(node.callee) === hook,
            ),
        )
      )
        report(
          "C11",
          meta,
          1,
          `Use the generated ${hook} hook in this page or its parts.`,
        );
    }
  }
}
