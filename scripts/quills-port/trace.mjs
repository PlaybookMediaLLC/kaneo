// Symbol-level tracer for the Quackback web app. It answers: from this route file (or this
// server function), which server functions, tables, permissions and side effects are reachable?
// ponytail: identifier-name resolution, not full type resolution. A local variable that shadows
// an import over-reports. Upgrade path: ts.Program + checker if the over-report matters.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// ponytail: @babel/parser is a transitive dependency of this repo, not a declared one.
// Upgrade path: declare it in the root package.json if this script joins CI.
const { parse } = createRequire(import.meta.url)("@babel/parser");

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export const AUTH_HELPERS = [
  "requireAuth",
  "requireTeamAuth",
  "getOptionalAuth",
  "withApiKeyAuth",
  "requireApiKey",
  "resolvePortalAccessForRequest",
  "requireWidgetAuth",
  "getWidgetSession",
  "verifySignature",
  "verifySlackSignature",
];

// Entering one of these areas records the side effect and stops the walk there.
const BOUNDARIES = [
  [/\/lib\/server\/events\//, "events"],
  [/\/lib\/server\/jobs\/|-queue\.ts$/, "jobs"],
  [/\/lib\/server\/email\//, "email"],
  [/\/lib\/server\/integrations\/|\/src\/integrations\//, "integrations"],
  [/\/lib\/server\/realtime\//, "realtime"],
  [/\/lib\/server\/storage\//, "storage"],
  // Engines that reach most of the schema. A capability outside the engine records the effect.
  [
    /\/domains\/(ai|assistant|embeddings|summary|sentiment|merge-suggestions)\//,
    "ai",
    /assistant|copilot|ask-search|merge-suggestion|functions\/feedback\.ts|kb-ask|suggestions|sentiment|\/domains\/(ai|assistant)\//,
  ],
  [/\/domains\/workflows\//, "workflows", /workflow/],
];
// Shared infrastructure that every capability reaches. The walk stops here so that the tables
// of the auth, settings and policy engines do not appear on every row. `unless` keeps the walk
// open when the traced capability itself lives in that area.
const INFRASTRUCTURE = [
  {
    pattern:
      /\/lib\/server\/auth\/|\/functions\/auth-helpers\.ts$|\/domains\/api\/(auth|rate-limit)\.ts$/,
    unless:
      /\/lib\/server\/auth\/|functions\/(auth|sso|device-auth|widget-auth|portal-session|instant-sso|recovery)/,
  },
  {
    pattern: /\/domains\/settings\//,
    unless:
      /settings|branding|portal|widget|locale|labs|feature-flags|onboarding|going-live|activation/,
  },
  {
    pattern: /\/domains\/principals\//,
    unless: /principal|admin\.ts|user|people|team/,
  },
  {
    pattern: /\/domains\/platform-credentials\//,
    unless: /credential|integration/,
  },
  {
    pattern:
      /\/lib\/server\/(config|cache|local-cache|request-memo|logger|kv|workspaces|telemetry|policy|audit|content|middleware|control-plane|fleet)(\/|\.ts$)/,
    unless: /\/lib\/server\/(policy|workspaces|control-plane|fleet)\//,
  },
];
// These areas are recorded and the walk continues, because their tables matter.
const MARKS = [
  [/webhook/i, "webhooks"],
  [/\/domains\/billing\/|stripe/i, "billing"],
  [/\/domains\/notifications\//, "notifications"],
];
const SERVER =
  /\/lib\/server\/|\/routes\/api\/|\/integrations\/[^/]+\/server\//;

export function createTracer(quackbackDir) {
  const src = join(quackbackDir, "apps/web/src");
  const files = new Map();

  const tableBySymbol = new Map();
  const schemaDir = join(quackbackDir, "packages/db/src/schema");
  for (const [symbol, sqlName] of tableDeclarations(schemaDir))
    tableBySymbol.set(symbol, sqlName);

  function resolveSpec(from, spec) {
    if (spec.startsWith("@quackback/db") || spec === "@/lib/server/db")
      return "db:";
    if (spec.startsWith("@quackback/email")) return "email:";
    const base = spec.startsWith("@/")
      ? join(src, spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(from), spec)
        : null;
    if (!base) return null;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ])
      if (existsSync(candidate) && statSync(candidate).isFile())
        return candidate;
    return null;
  }

  function load(file) {
    if (files.has(file)) return files.get(file);
    const text = readFileSync(file, "utf8");
    const source = parse(text, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy"],
      errorRecovery: true,
    }).program;
    const info = {
      file,
      text,
      imports: new Map(),
      reexports: new Map(),
      stars: [],
      statements: [],
      declared: new Map(),
      handlers: [],
      routePath: null,
    };
    files.set(file, info);
    for (const statement of source.body) {
      if (statement.type === "ImportDeclaration") {
        const spec = statement.source.value;
        for (const specifier of statement.specifiers)
          info.imports.set(specifier.local.name, {
            spec,
            name:
              specifier.type === "ImportDefaultSpecifier"
                ? "default"
                : specifier.type === "ImportNamespaceSpecifier"
                  ? "*"
                  : (specifier.imported.name ?? specifier.imported.value),
          });
        continue;
      }
      if (statement.type === "ExportAllDeclaration") {
        info.stars.push(statement.source.value);
        continue;
      }
      if (statement.type === "ExportNamedDeclaration" && statement.source) {
        for (const specifier of statement.specifiers)
          info.reexports.set(
            specifier.exported.name ?? specifier.exported.value,
            {
              spec: statement.source.value,
              name: specifier.local.name ?? specifier.local.value,
            },
          );
        continue;
      }
      const index = info.statements.length;
      const entry = {
        ...collect(statement),
        text: text.slice(statement.start, statement.end),
      };
      info.statements.push(entry);
      for (const name of declaredNames(statement))
        info.declared.set(name, index);
      if (/createFileRoute\(/.test(entry.text)) {
        info.routePath =
          /createFileRoute\(\s*['"`]([^'"`]+)['"`]/.exec(entry.text)?.[1] ??
          null;
        findHandlers(statement, info);
      }
    }
    return info;
  }

  function children(node, visit) {
    for (const key in node) {
      if (
        key === "loc" ||
        key === "leadingComments" ||
        key === "trailingComments"
      )
        continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value)
          if (item && typeof item.type === "string") visit(item, node, key);
      } else if (value && typeof value.type === "string")
        visit(value, node, key);
    }
  }

  function collect(root) {
    const ids = new Set();
    const dynamic = [];
    const visit = (node, parent, key) => {
      if (node.type === "Identifier") {
        const isMemberName =
          (parent?.type === "MemberExpression" ||
            parent?.type === "OptionalMemberExpression") &&
          key === "property" &&
          !parent.computed;
        const isKey =
          (parent?.type === "ObjectProperty" ||
            parent?.type === "ObjectMethod") &&
          key === "key" &&
          !parent.computed &&
          !parent.shorthand;
        if (!isMemberName && !isKey) ids.add(node.name);
      }
      if (
        node.type === "JSXIdentifier" &&
        ((parent?.type === "JSXOpeningElement" && key === "name") ||
          (parent?.type === "JSXMemberExpression" && key === "object"))
      )
        ids.add(node.name);
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Import" &&
        node.arguments[0]?.type === "StringLiteral"
      )
        dynamic.push({ spec: node.arguments[0].value, names: null, node });
      if (
        node.type === "VariableDeclarator" &&
        node.id.type === "ObjectPattern" &&
        node.init
      ) {
        let init = node.init;
        while (
          init.type === "AwaitExpression" ||
          init.type === "ParenthesizedExpression"
        )
          init = init.argument ?? init.expression;
        if (init.type === "CallExpression" && init.callee.type === "Import")
          dynamic.push({
            spec: init.arguments[0]?.value,
            names: node.id.properties.flatMap((property) =>
              property.key?.name ? [property.key.name] : [],
            ),
            node: init,
          });
      }
      children(node, visit);
    };
    visit(root, null, null);
    // A destructured dynamic import was also seen as a bare call; keep the named form.
    const named = new Set(dynamic.filter((d) => d.names).map((d) => d.node));
    return {
      ids,
      dynamic: dynamic
        .filter((d) => d.spec && (d.names || !named.has(d.node)))
        .map((d) => ({ spec: d.spec, names: d.names ?? ["*"] })),
    };
  }

  function declaredNames(statement) {
    const names = [];
    if (statement.type === "ExportDefaultDeclaration") names.push("default");
    const node =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (!node) return names;
    if (node.type === "VariableDeclaration")
      for (const declaration of node.declarations) {
        if (declaration.id.type === "Identifier")
          names.push(declaration.id.name);
        else if (declaration.id.type === "ObjectPattern")
          for (const property of declaration.id.properties)
            if (property.value?.type === "Identifier")
              names.push(property.value.name);
      }
    else if (node.id?.type === "Identifier") names.push(node.id.name);
    return names;
  }

  function findHandlers(statement, info) {
    const visit = (node) => {
      if (
        node.type === "ObjectProperty" &&
        node.key.name === "handlers" &&
        node.value.type === "ObjectExpression"
      )
        for (const property of node.value.properties) {
          const name = property.key?.name;
          if (METHODS.has(name))
            info.handlers.push({
              method: name,
              ...collect(property),
              text: info.text.slice(property.start, property.end),
            });
        }
      children(node, visit);
    };
    visit(statement);
  }

  /** start: { file, all: true } | { file, name } | { file, node: {ids, dynamic, text} } */
  function trace(start) {
    const out = {
      capabilities: new Set(),
      tables: new Set(),
      permissions: new Set(),
      helpers: new Set(),
      effects: new Set(),
    };
    const seen = new Set();
    const startArea = BOUNDARIES.find(
      ([pattern, , unless]) =>
        pattern.test(start.file) || unless?.test(start.file),
    )?.[1];
    const queue = [];

    const enterFile = (file, name) => {
      if (file === "db:") {
        if (tableBySymbol.has(name)) out.tables.add(tableBySymbol.get(name));
        return;
      }
      if (file === "email:") return void out.effects.add("email");
      if (!file || !/\.tsx?$/.test(file)) return;
      const hit = BOUNDARIES.find(([pattern]) => pattern.test(file));
      const boundary = hit?.[1];
      if (boundary && boundary !== startArea && !hit[2]?.test(start.file))
        return void out.effects.add(boundary);
      if (
        file !== start.file &&
        INFRASTRUCTURE.some(
          (area) => area.pattern.test(file) && !area.unless.test(start.file),
        )
      )
        return;
      for (const [pattern, mark] of MARKS)
        if (pattern.test(file)) out.effects.add(mark);
      const info = load(file);
      if (name === "*") {
        info.statements.forEach((_, index) => queue.push([file, index]));
        return;
      }
      if (info.declared.has(name))
        return void queue.push([file, info.declared.get(name)]);
      const reexport = info.reexports.get(name);
      if (reexport)
        return enterFile(resolveSpec(file, reexport.spec), reexport.name);
      for (const spec of info.stars) {
        const key = `star:${file}:${spec}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        enterFile(resolveSpec(file, spec), name);
      }
    };

    const scan = (file, node) => {
      const info = load(file);
      if (SERVER.test(file)) {
        for (const match of node.text.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g))
          out.permissions.add(match[1]);
        for (const helper of AUTH_HELPERS)
          if (node.ids.has(helper)) out.helpers.add(helper);
      }
      for (const id of node.ids) {
        const imported = info.imports.get(id);
        if (imported)
          enterFile(resolveSpec(file, imported.spec), imported.name);
        else if (info.declared.has(id))
          queue.push([file, info.declared.get(id)]);
      }
      for (const { spec, names } of node.dynamic)
        for (const name of names) enterFile(resolveSpec(file, spec), name);
    };

    if (start.node) scan(start.file, start.node);
    else enterFile(start.file, start.all ? "*" : start.name);
    while (queue.length) {
      const [file, index] = queue.pop();
      const key = `${file}#${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const statement = load(file).statements[index];
      const capability = capabilityOf(file, index);
      if (
        capability &&
        !(
          start.name &&
          start.file === file &&
          capability.endsWith(`#${start.name}`)
        )
      )
        out.capabilities.add(capability);
      scan(file, statement);
    }
    return out;
  }

  function capabilityOf(file, index) {
    const info = load(file);
    const statement = info.statements[index];
    if (!/=\s*createServerFn\(/.test(statement.text)) return null;
    for (const [name, at] of info.declared)
      if (at === index) return `${relative(src, file)}#${name}`;
    return null;
  }

  function serverFunctions(file) {
    const info = load(file);
    const found = [];
    for (const [name, index] of info.declared) {
      const text = info.statements[index].text;
      if (!/=\s*createServerFn\(/.test(text)) continue;
      found.push({
        name,
        method:
          /createServerFn\(\s*\{\s*method:\s*['"](\w+)['"]/.exec(text)?.[1] ??
          "GET",
      });
    }
    return found;
  }

  return { src, load, trace, serverFunctions, tableBySymbol };
}

export function tableDeclarations(schemaDir) {
  const found = [];
  for (const name of readdirSync(schemaDir)) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(join(schemaDir, name), "utf8");
    for (const match of text.matchAll(
      /export const (\w+) = (?:pgTable|\w+\s*\.\s*table)\(\s*['"]([\w]+)['"]/g,
    ))
      found.push([match[1], match[2]]);
  }
  return found;
}
