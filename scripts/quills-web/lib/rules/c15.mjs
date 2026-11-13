import { imports, calls, nameOf } from "./ast.mjs";
export function check({ documents, report }) {
  for (const d of documents.filter((d) => d.kind === "test")) {
    const boundary = /\/(boundaries|conformance)\.test\.ts$/.test(d.file);
    for (const i of imports(d))
      if (
        i.source === "@testing-library/react" &&
        i.imported.some((name) =>
          ["render", "renderHook", "default"].includes(name),
        )
      )
        report("C15", d, i.node, "Render through the Quills test kit.");
    for (const { node } of d.nodes)
      if (node.type === "CallExpression") {
        const call = nameOf(node.callee);
        if (/^(it|test)\.(skip|todo)$/.test(call))
          report("C15", d, node, "Implement the test instead of skipping it.");
        if (["it", "test"].includes(call)) {
          const callback = node.arguments.find((a) =>
            ["ArrowFunctionExpression", "FunctionExpression"].includes(a.type),
          );
          const body = callback?.body?.body;
          if (
            Array.isArray(body) &&
            body.every(
              (s) =>
                s.type === "ExpressionStatement" &&
                nameOf(s.expression?.callee).endsWith(".toBeDefined"),
            )
          )
            report(
              "C15",
              d,
              node,
              "Assert behavior, not only that an export exists.",
            );
        }

        if (/(?:ByTestId|Snapshot|setTimeout)/.test(call))
          report(
            "C15",
            d,
            node,
            "Use role queries and deterministic assertions without snapshots or timer sleeps.",
          );
        if (
          call === "vi.mock" &&
          /(?:quills|^\.)/.test(node.arguments[0]?.value ?? "")
        )
          report(
            "C15",
            d,
            node,
            "Use mockApi instead of mocking Quills modules.",
          );
      }
    if (boundary) continue;
    const source = documents.find(
      (s) =>
        s.file === d.file.replace(/\.test(?=\.tsx?$)/, "") ||
        s.file === d.file.replace(/\.test\.tsx$/, ".ts"),
    );
    const expected = {
      operation: "describeOperationContract",
      hook: "describeHookContract",
      page: "describePageContract",
      form: "describeFormContract",
    }[source?.kind];
    if (expected && !calls(d, expected).length)
      report("C15", d, 1, `Call ${expected} from the shared kit.`);
    if (
      ["component", "part"].includes(source?.kind) &&
      !calls(d, "renderComponent").length
    )
      report("C15", d, 1, "Render the component with the shared test kit.");
  }
}
