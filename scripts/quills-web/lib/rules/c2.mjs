export function check({ documents, files, report }) {
  for (const d of documents) {
    if (
      !/\.tsx?$/.test(d.file) ||
      ["test", "meta", "type", "fixture"].includes(d.kind)
    )
      continue;
    if (
      d.ast.body.every(
        (n) =>
          n.type === "ImportDeclaration" ||
          (n.type === "ExportNamedDeclaration" &&
            (n.source ||
              n.exportKind === "type" ||
              (n.declaration?.type ?? "").startsWith("TS"))),
      )
    )
      continue;
    const base = d.file.replace(/\.tsx?$/, "");
    if (!files.has(`${base}.test.ts`) && !files.has(`${base}.test.tsx`))
      report("C2", d, 1, "Add a colocated behavior or contract test.");
  }
}
