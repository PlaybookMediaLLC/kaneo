import { nameOf, imports, jsx } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind === "page")) {
    const returns = d.nodes.filter(
      ({ node }) =>
        node.type === "ReturnStatement" && node.argument?.type === "JSXElement",
    );
    if (
      !returns.some(
        ({ node }) => nameOf(node.argument.openingElement.name) === "PageFrame",
      )
    )
      report("C14", d, 1, "Render PageFrame as the page root.");
    const hookImports = imports(d).filter((i) => i.source.includes("/hooks/"));
    if (hookImports.length && !jsx(d, "StateView").length)
      report("C14", d, 1, "Pass query state through StateView.");
    for (const i of imports(d))
      if (i.source.includes("/api/") && !i.typeOnly)
        report("C14", d, i.node, "Pages import generated hooks, not fetchers.");
    for (const { node } of d.nodes)
      if (
        node.type === "CallExpression" &&
        [
          "useQuery",
          "useMutation",
          "useInfiniteQuery",
          "fetch",
          "globalThis.fetch",
          "window.fetch",
        ].includes(nameOf(node.callee))
      )
        report("C14", d, node, "Use a generated hook.");
  }
}
