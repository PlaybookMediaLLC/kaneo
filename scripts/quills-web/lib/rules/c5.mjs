import { imports, resolveImport, valueOf, nameOf } from "./ast.mjs";
import { teamRoutes } from "../files.mjs";
export function check({ documents, report }) {
  for (const d of documents)
    for (const i of [
      ...imports(d),
      ...d.nodes.flatMap(({ node }) => {
        if (
          [
            "ImportExpression",
            "ExportAllDeclaration",
            "ExportNamedDeclaration",
          ].includes(node.type) &&
          node.source
        )
          return [{ node, source: valueOf(node.source) }];
        if (node.type === "CallExpression" && nameOf(node.callee) === "require")
          return [{ node, source: valueOf(node.arguments[0]) }];
        return [];
      }),
    ]) {
      if (typeof i.source !== "string") {
        report("C5", d, i.node, "Imports must use a static module path.");
        continue;
      }
      const target = resolveImport(d.file, i.source);
      if (!target) continue;
      if (
        d.file.endsWith("/quills/conformance.test.ts") &&
        target.startsWith("scripts/quills-web/lib/rules/")
      )
        continue;
      if (
        d.file === "apps/web/src/quills/portal/prefetch.test.ts" &&
        target === "apps/web/src/routeTree.gen"
      )
        continue;
      if (d.file.endsWith("/ui/upstream.ts")) continue;
      if (
        !target.startsWith("apps/web/src/quills/") &&
        !target.startsWith("apps/web/src/routes/portal/") &&
        !target.startsWith("apps/web/src/routes/quills/") &&
        !target.startsWith(`${teamRoutes}/`)
      )
        report(
          "C5",
          d,
          i.node,
          "Import upstream modules only through quills/ui/upstream.ts.",
        );
      if (target.includes("/pages/") && target.includes("/parts/")) {
        const page = target.split("/parts/")[0];
        if (!d.file.startsWith(`${page}/`))
          report(
            "C5",
            d,
            i.node,
            "A page-local part may be imported only by that page.",
          );
      }
    }
}
