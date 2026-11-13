import { calls, nameOf, valueOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind === "operation"))
    for (const { node } of calls(d, "quillsKey")) {
      if (
        node.arguments.length !== 5 ||
        node.arguments[1]?.type !== "Identifier"
      )
        report(
          "C8",
          d,
          node,
          "Pass workspace, viewer, area, operation and input to quillsKey.",
        );
    }
  for (const d of documents.filter((d) => d.kind === "operation"))
    if (!calls(d, "quillsKey").length)
      report(
        "C8",
        d,
        1,
        "Build operation keys with quillsKey(workspace, viewer, area, operation, input).",
      );
  for (const d of documents.filter(
    (d) => d.kind === "hook" || d.kind === "operation",
  ))
    for (const { node } of d.nodes) {
      if (
        node.type === "Property" &&
        (node.key.name ?? valueOf(node.key)) === "queryKey" &&
        !nameOf(node.value?.callee).endsWith("Key") &&
        node.value?.type !== "MemberExpression"
      )
        report(
          "C8",
          d,
          node,
          "Use the operation key builder instead of an inline query key.",
        );
    }
}
