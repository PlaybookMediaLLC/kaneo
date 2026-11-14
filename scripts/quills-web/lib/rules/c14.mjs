import { nameOf, imports, jsx } from "./ast.mjs";
const folderOf = (file) => file.slice(0, file.lastIndexOf("/"));
export function check({ documents, report }) {
  // Teammate pages run in the app shell, which has no portal gate or runtime.
  const teamFolders = documents
    .filter((d) => d.kind === "meta" && d.meta?.audience === "teammate")
    .map((d) => `${folderOf(d.file)}/`);
  for (const d of documents.filter(
    (d) =>
      ["page", "part", "form"].includes(d.kind) &&
      teamFolders.some((folder) => d.file.startsWith(folder)),
  ))
    for (const i of imports(d))
      if (
        i.imported.some((n) => ["PortalGate", "usePortalRuntime"].includes(n))
      )
        report(
          "C14",
          d,
          i.node,
          "Teammate pages use useTeamRuntime and TeamStateView, not the portal gate or runtime.",
        );
  for (const d of documents.filter((d) => d.kind === "page")) {
    const teammate = teamFolders.includes(`${folderOf(d.file)}/`);
    const stateView = teammate ? "TeamStateView" : "StateView";
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
    if (hookImports.length && !jsx(d, stateView).length)
      report("C14", d, 1, `Pass query state through ${stateView}.`);
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
