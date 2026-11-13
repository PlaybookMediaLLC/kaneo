export function check({ documents, report }) {
  for (const d of documents) {
    if (/\/index\.tsx?$/.test(d.file) && !d.file.includes("/routes/"))
      report(
        "C17",
        d,
        1,
        "Import modules directly instead of creating a barrel.",
      );
    for (const { node } of d.nodes)
      if (
        node.type === "ExportDefaultDeclaration" ||
        ((node.type === "ExportAllDeclaration" ||
          (node.type === "ExportNamedDeclaration" && node.source)) &&
          !d.file.endsWith("/ui/upstream.ts") &&
          !(
            d.file.endsWith("/api/client.ts") &&
            node.source?.value === "@kaneo/libs"
          ))
      )
        report(
          "C17",
          d,
          node,
          "Use named direct exports; only the upstream adapter re-exports modules.",
        );
  }
}
