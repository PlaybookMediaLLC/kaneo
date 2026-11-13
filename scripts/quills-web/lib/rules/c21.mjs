import { valueOf, nameOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents) {
    if (d.file.endsWith("/portal-href.ts") || ["meta", "test"].includes(d.kind))
      continue;
    for (const { node, parent } of d.nodes) {
      const value =
        node.type === "TemplateLiteral"
          ? node.quasis[0]?.value.cooked
          : valueOf(node);
      if (typeof value !== "string" || !value.startsWith("/portal/")) continue;
      if (
        d.kind === "route" &&
        ((parent?.type === "CallExpression" &&
          ["createFileRoute", "redirect"].includes(nameOf(parent.callee))) ||
          (["Property", "ObjectProperty"].includes(parent?.type) &&
            (valueOf(parent.key) ?? nameOf(parent.key)) === "to"))
      )
        continue;
      report(
        "C21",
        d,
        node,
        "Build portal links with portalHref; route declarations are the only path-literal exception.",
      );
    }
  }
}
