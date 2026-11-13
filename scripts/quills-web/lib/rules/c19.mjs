import { valueOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents) {
    if (d.file.endsWith(".css"))
      report(
        "C19",
        d,
        1,
        "Use existing theme-token classes, not a new CSS file.",
      );
    if (!["page", "component", "part", "form"].includes(d.kind)) continue;
    for (const { node, parent } of d.nodes) {
      if (node.type === "JSXAttribute" && node.name.name === "style")
        report(
          "C19",
          d,
          parent?.type === "JSXOpeningElement" ? parent : node,
          "Use theme-token classes instead of inline styles.",
        );
      const value = valueOf(node);
      if (
        typeof value === "string" &&
        /#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab)a?\(/i.test(value)
      )
        report(
          "C19",
          d,
          node,
          "Use semantic theme tokens instead of color literals.",
        );
    }
  }
}
