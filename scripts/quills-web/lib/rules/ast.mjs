import { dirname, resolve } from "node:path";

export function nodes(ast) {
  const output = [];
  function visit(node, parent) {
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "string") output.push({ node, parent });
    for (const [key, value] of Object.entries(node)) {
      if (["parent", "loc", "range", "tokens", "comments"].includes(key))
        continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === "object") visit(value, node);
    }
  }
  visit(ast, null);
  return output;
}

export function unwrap(input) {
  let node = input;
  while (
    [
      "TSSatisfiesExpression",
      "TSAsExpression",
      "TSNonNullExpression",
      "ParenthesizedExpression",
    ].includes(node?.type)
  )
    node = node.expression;
  return node;
}

export function valueOf(input) {
  const node = unwrap(input);
  if (!node) return undefined;
  if (
    ["Literal", "StringLiteral", "NumericLiteral", "BooleanLiteral"].includes(
      node.type,
    )
  )
    return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis.map((q) => q.value.cooked).join("");
  if (node.type === "ArrayExpression") return node.elements.map(valueOf);
  if (node.type === "ObjectExpression") {
    const result = {};
    for (const property of node.properties) {
      if (
        !["Property", "ObjectProperty"].includes(property.type) ||
        property.computed
      )
        return undefined;
      const key = property.key.name ?? property.key.value;
      result[key] = valueOf(property.value);
    }
    return result;
  }
  return undefined;
}

export function nameOf(node) {
  if (!node) return "";
  if (["Identifier", "JSXIdentifier"].includes(node.type)) return node.name;
  if (["MemberExpression", "JSXMemberExpression"].includes(node.type))
    return `${nameOf(node.object)}.${node.computed ? valueOf(node.property) : nameOf(node.property)}`;
  return "";
}

export function exportedNames(ast) {
  return (ast.body ?? []).flatMap((node) => {
    if (node.type !== "ExportNamedDeclaration") return [];
    const declaration = node.declaration;
    return declaration?.type === "VariableDeclaration"
      ? declaration.declarations.map((item) => item.id.name)
      : declaration?.id
        ? [declaration.id.name]
        : node.specifiers.map((item) => item.exported.name);
  });
}

export function declaration(doc, name) {
  return doc.nodes.find(
    ({ node }) => node.type === "VariableDeclarator" && node.id.name === name,
  )?.node.init;
}

export function imports(doc) {
  return doc.nodes
    .filter(({ node }) => node.type === "ImportDeclaration")
    .map(({ node }) => ({
      node,
      source: node.source.value,
      names: node.specifiers.map((s) => s.local.name),
      imported: node.specifiers.map((s) => s.imported?.name ?? "default"),
      typeOnly:
        node.importKind === "type" ||
        node.specifiers.every((s) => s.importKind === "type"),
    }));
}

export function resolveImport(file, source) {
  if (source.startsWith("@/")) return `apps/web/src/${source.slice(2)}`;
  if (!source.startsWith(".")) return null;
  return resolve("/", dirname(file), source).slice(1);
}

export function kindOf(file) {
  if (/\.test\.[cm]?[jt]sx?$/.test(file)) return "test";
  if (file.endsWith(".fixture.ts")) return "fixture";
  if (file.endsWith(".type.ts")) return "type";
  if (file.endsWith("/meta.ts")) return "meta";
  if (file.includes("/routes/")) return "route";
  if (/\/pages\/[^/]+\/[^/]+-page\.tsx$/.test(file)) return "page";
  if (file.includes("/parts/"))
    return file.endsWith("-form.tsx") ? "form" : "part";
  if (file.includes("/quills/ui/") && file.endsWith(".tsx")) return "component";
  if (/\/quills\/api\/[^/]+\/[^/]+\.ts$/.test(file)) return "operation";
  if (file.includes("/quills/hooks/")) return "hook";
  return "helper";
}

export { kebab, pascal } from "../naming.mjs";
export const lineOf = (node) => node?.loc?.start?.line ?? 1;
export const calls = (doc, name) =>
  doc.nodes.filter(
    ({ node }) =>
      node.type === "CallExpression" && nameOf(node.callee) === name,
  );
export const jsx = (doc, name) =>
  doc.nodes.filter(
    ({ node }) =>
      node.type === "JSXOpeningElement" && nameOf(node.name) === name,
  );
