import { imports, calls, nameOf, declaration } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind === "operation")) {
    if (
      !imports(d).some(
        (i) => i.source.endsWith("/client") && i.imported.includes("client"),
      ) ||
      !calls(d, "toPortalProblem").length ||
      !nameOf(declaration(d, "endpoint")).startsWith("client.") ||
      !calls(d, "endpoint").length
    )
      report(
        "C7",
        d,
        1,
        "Use the typed client endpoint and map failed responses through toPortalProblem.",
      );
    for (const { node } of d.nodes)
      if (
        node.type === "CallExpression" &&
        /(^|\.)(fetch|axios)$/.test(nameOf(node.callee))
      )
        report(
          "C7",
          d,
          node,
          "Raw HTTP calls are not permitted in operations.",
        );
  }
}
