export function check({ documents, report }) {
  for (const d of documents.filter((d) =>
    ["page", "component", "part", "form"].includes(d.kind),
  ))
    if (d.code.trimEnd().split("\n").length > 200)
      report(
        "C18",
        d,
        201,
        "Split this component into parts or pure helpers; maximum 200 lines.",
      );
}
