import { imports, nameOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind === "route")) {
    const pages = imports(d)
      .filter((i) => i.source.startsWith("@/quills/") && !i.typeOnly)
      .flatMap((i) => i.names);
    const elements = d.nodes.filter(
      ({ node }) => node.type === "JSXOpeningElement",
    );
    const redirects = d.nodes.some(
      ({ node }) =>
        node.type === "CallExpression" && nameOf(node.callee) === "redirect",
    );
    if (
      elements.length !== 1 ||
      !pages.includes(nameOf(elements[0]?.node.name))
    ) {
      const directComponent = d.nodes.some(
        ({ node }) =>
          node.type === "Property" &&
          node.key?.name === "component" &&
          pages.includes(nameOf(node.value)),
      );
      if ((!redirects && !directComponent) || elements.length)
        report(
          "C1",
          d,
          1,
          "Render exactly one imported Quills page/layout, or declare a redirect-only route.",
        );
    }
    for (const { node } of d.nodes)
      if (
        node.type === "CallExpression" &&
        /^(useState|useEffect|useQuery|useMutation|fetch)$/.test(
          nameOf(node.callee),
        )
      )
        report(
          "C1",
          d,
          node,
          "Move behavior and data access out of the route.",
        );
  }
}
