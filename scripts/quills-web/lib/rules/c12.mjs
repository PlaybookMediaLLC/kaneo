export function check({ documents, report }) {
  for (const d of documents)
    for (const [index, line] of d.code.split("\n").entries())
      if (line.includes("TODO(quills-web)"))
        report(
          "C12",
          d,
          index + 1,
          "Replace the generated TODO marker with implemented behavior.",
        );
}
