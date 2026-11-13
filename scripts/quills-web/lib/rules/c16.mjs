import { nameOf, valueOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind === "fixture")) {
    if (
      !d.nodes.some(
        ({ node }) =>
          node.type === "TSSatisfiesExpression" &&
          nameOf(node.typeAnnotation?.typeName).endsWith("Response"),
      )
    )
      report(
        "C16",
        d,
        1,
        "The fixture body must satisfy its operation response type.",
      );
    for (const { node } of d.nodes) {
      if (
        node.type === "NewExpression" ||
        (node.type === "CallExpression" &&
          /^(Date\.now|Math\.random|crypto\.)/.test(nameOf(node.callee)))
      )
        report(
          "C16",
          d,
          node,
          "Use fixed fixture values, not time/random constructors.",
        );
      const value = valueOf(node);
      if (typeof value !== "string") continue;
      if (
        /[^\s@]+@[^\s@]+/.test(value) &&
        !/^[^\s@]+@example\.test$/.test(value)
      )
        report("C16", d, node, "Fixture email addresses use example.test.");
      if (
        /(?:https?:\/\/[^/\s]+:[^/\s]+@|(?:sk|ghp|gho|xoxb)[_-][A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/.test(
          value,
        )
      )
        report(
          "C16",
          d,
          node,
          "Do not put credentials or token-like literals in fixtures.",
        );
    }
  }
}
