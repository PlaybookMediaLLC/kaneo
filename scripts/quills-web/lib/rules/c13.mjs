import { exportedNames, imports } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) =>
    ["component", "part", "form", "page"].includes(d.kind),
  )) {
    const names = exportedNames(d.ast);
    const components = d.nodes.filter(
      ({ node }) =>
        (node.type === "FunctionDeclaration" &&
          /^[A-Z]/.test(node.id?.name ?? "")) ||
        (node.type === "VariableDeclarator" &&
          /^[A-Z]/.test(node.id?.name ?? "") &&
          ["ArrowFunctionExpression", "FunctionExpression"].includes(
            node.init?.type,
          )),
    );
    if (components.length !== 1)
      report("C13", d, 1, "Keep one named component per file.");
    for (const { node } of components)
      if (
        !names.includes(node.id.name) ||
        !names.includes(`${node.id.name}Props`)
      )
        report(
          "C13",
          d,
          node,
          `Export ${node.id.name} and ${node.id.name}Props.`,
        );
    if (d.kind === "component")
      for (const i of imports(d))
        if (
          /(?:^|\/)(?:hooks|api)(?:\/|$)|react-router/.test(i.source) ||
          i.imported.some((n) =>
            [
              "authClient",
              "client",
              "useQuery",
              "useMutation",
              "useInfiniteQuery",
              "Link",
              "useNavigate",
              "useRouter",
            ].includes(n),
          )
        )
          report(
            "C13",
            d,
            i.node,
            "Shared UI receives data and callbacks through props; move data/router hooks to the page.",
          );
  }
}
