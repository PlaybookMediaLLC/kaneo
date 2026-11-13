import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

function rule(message, visitors) {
  return defineRule({
    meta: { messages: { violation: message } },
    create(context) {
      return Object.fromEntries(
        Object.entries(visitors).map(([kind, predicate]) => [
          kind,
          (node) => {
            if (predicate(node))
              context.report({ node, messageId: "violation" });
          },
        ]),
      );
    },
  });
}

const rules = {
  "capture-ast": defineRule({
    meta: { messages: {} },
    create(context) {
      return {
        Program(node) {
          const directory = process.env.QUILLS_WEB_AST_DIR;
          if (!directory) return;
          const filename =
            context.filename ?? context.getFilename?.() ?? "unknown";
          mkdirSync(directory, { recursive: true });
          const hash = createHash("sha256").update(filename).digest("hex");
          const ast = context.sourceCode?.ast ?? node;
          const comments = context.sourceCode?.getAllComments?.() ?? [];
          writeFileSync(
            join(directory, `${hash}.json`),
            JSON.stringify(
              { filename, ast: { ...ast, comments } },
              (key, value) => (key === "parent" ? undefined : value),
            ),
          );
        },
      };
    },
  }),
  "c3-visible-text": rule(
    "C3: Put visible JSX text in the quills translation namespace.",
    { JSXText: (node) => node.value.trim().length > 0 },
  ),
  "c7-raw-fetch": rule(
    "C7: Use the typed client and toPortalProblem, not fetch.",
    {
      CallExpression: (node) =>
        node.callee?.type === "Identifier" && node.callee.name === "fetch",
    },
  ),
  "c17-default-export": rule("C17: Quills code uses named exports.", {
    ExportDefaultDeclaration: () => true,
  }),
  "c19-inline-style": rule(
    "C19: Use theme-token classes instead of inline styles.",
    { JSXAttribute: (node) => node.name?.name === "style" },
  ),
};

export default definePlugin({ meta: { name: "quills-web" }, rules });
