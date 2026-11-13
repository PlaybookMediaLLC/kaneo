import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { valueOf, nameOf } from "./ast.mjs";
const normalized = (path) =>
  typeof path === "string" ? path.replace(/\/$/, "") : path;
export async function check({ root, documents, report }) {
  const metas = documents.filter((d) => d.kind === "meta");
  const routePaths = new Set(
    documents
      .filter((d) => d.kind === "route")
      .flatMap((d) =>
        d.nodes
          .filter(
            ({ node }) =>
              node.type === "CallExpression" &&
              nameOf(node.callee) === "createFileRoute",
          )
          .map(({ node }) => normalized(valueOf(node.arguments[0]))),
      ),
  );
  const { portalPathPatterns } = await import(
    pathToFileURL(join(root, "apps/api/src/quills/portal/paths.ts")).href
  );
  for (const pattern of portalPathPatterns.filter((p) => !p.pending))
    if (
      !metas.some(
        (d) =>
          d.meta?.mailLinked &&
          normalized(d.meta.route) === normalized(pattern.pattern),
      )
    )
      report(
        "C6",
        { file: "apps/api/src/quills/portal/paths.ts" },
        1,
        `Add a mail-linked page for ${pattern.pattern}.`,
      );
  for (const d of metas) {
    if (!routePaths.has(normalized(d.meta?.route)))
      report("C6", d, 1, "The page declaration must match a generated route.");
    if (
      d.meta?.mailLinked &&
      !portalPathPatterns.some(
        (p) => !p.pending && normalized(p.pattern) === normalized(d.meta.route),
      )
    )
      report(
        "C6",
        d,
        1,
        "Register the mail-linked route in portalPathPatterns.",
      );
  }
}
