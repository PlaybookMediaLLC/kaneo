import { jsx, nameOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const meta of documents.filter(
    (d) => d.kind === "meta" && d.meta?.token !== "none",
  )) {
    const folder = meta.file.slice(0, -7);
    for (const d of documents.filter(
      (d) =>
        d.file.startsWith(folder) && ["page", "part", "form"].includes(d.kind),
    )) {
      if (jsx(d, "PortalForm").length || jsx(d, "form").length)
        report("C9", d, 1, "Token actions must use ConfirmAction, not a form.");
      for (const { node } of d.nodes)
        if (
          node.type === "CallExpression" &&
          /\.(mutate|mutateAsync)$/.test(nameOf(node.callee))
        ) {
          const confirm = jsx(d, "ConfirmAction").some(({ node: el }) =>
            el.attributes.some(
              (a) =>
                a.name?.name === "onConfirm" &&
                (a.start ?? a.range?.[0]) <= (node.start ?? node.range?.[0]) &&
                (a.end ?? a.range?.[1]) >= (node.end ?? node.range?.[1]),
            ),
          );
          if (!confirm)
            report(
              "C9",
              d,
              node,
              "Call token mutations only within ConfirmAction.onConfirm.",
            );
        }
    }
  }
}
