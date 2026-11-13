import { valueOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind !== "test"))
    for (const { node, parent } of d.nodes) {
      if (node.type === "JSXText" && node.value.trim())
        report("C3", d, node, "Translate visible JSX text.");
      if (
        node.type === "JSXExpressionContainer" &&
        parent?.type !== "JSXAttribute" &&
        typeof valueOf(node.expression) === "string" &&
        valueOf(node.expression).trim()
      )
        report("C3", d, node, "Translate visible literal expressions.");
      if (
        node.type === "JSXAttribute" &&
        ["aria-label", "title", "placeholder", "alt"].includes(
          node.name.name,
        ) &&
        typeof valueOf(node.value?.expression ?? node.value) === "string"
      )
        report(
          "C3",
          d,
          node,
          "Use a translation for the accessible text attribute.",
        );
    }
}
