import { exportedNames, jsx, imports } from "./ast.mjs";
export function check({ documents, report }) {
  const gallery = documents.find((d) =>
    d.file.endsWith("/dev/kit-gallery.tsx"),
  );
  for (const d of documents.filter((d) => d.kind === "component")) {
    const component = exportedNames(d.ast).find(
      (n) => /^[A-Z]/.test(n) && !n.endsWith("Props"),
    );
    if (
      !component ||
      !gallery ||
      !imports(gallery).some((i) => i.imported.includes(component)) ||
      !jsx(gallery, component).length
    )
      report(
        "C23",
        d,
        1,
        "Import and demonstrate this kit component in the development gallery.",
      );
  }
}
