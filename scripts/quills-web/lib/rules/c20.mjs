export function check({ documents, operations, report }) {
  for (const d of documents.filter((d) => d.kind === "page"))
    if (
      !documents.some(
        (m) =>
          m.kind === "meta" &&
          m.file === d.file.slice(0, d.file.lastIndexOf("/")) + "/meta.ts",
      )
    )
      report("C20", d, 1, "Add the page metadata declaration.");
  for (const d of documents.filter((d) => d.kind === "meta")) {
    const m = d.meta;
    if (
      !m ||
      !["public", "portal", "signed-in", "teammate", "development"].includes(
        m.audience,
      ) ||
      !Array.isArray(m.states) ||
      !Array.isArray(m.operations) ||
      !["none", "query", "fragment"].includes(m.token)
    ) {
      report(
        "C20",
        d,
        1,
        "Declare static audience, states, operations and token policy.",
      );
      continue;
    }
    if (
      m.operations.some((id) => operations.get(id)?.method === "get") &&
      (!m.states.includes("loading") || !m.states.includes("failed"))
    )
      report("C20", d, 1, "Query pages declare loading and failed states.");
    if (m.token !== "none" && !m.states.includes("gone"))
      report("C20", d, 1, "Token pages declare the gone state.");
  }
}
