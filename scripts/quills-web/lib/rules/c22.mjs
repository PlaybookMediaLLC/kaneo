import { jsx, calls } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter(
    (d) => d.kind !== "test" && !d.file.endsWith("/ui/portal-form.tsx"),
  )) {
    for (const { node } of [...jsx(d, "form"), ...calls(d, "useForm")])
      report("C22", d, node, "Forms must use the shared PortalForm.");
    if (d.kind === "form" && !jsx(d, "PortalForm").length)
      report("C22", d, 1, "Render the shared PortalForm.");
  }
}
