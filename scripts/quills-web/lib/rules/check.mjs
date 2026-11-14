import { spawnSync } from "node:child_process";
import {
  readdir,
  readFile,
  stat,
  mkdtemp,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nodes, kindOf, declaration, valueOf, lineOf } from "./ast.mjs";
import { legacyTeamRoutes, teamRoutes } from "../files.mjs";

const rulesDirectory = dirname(fileURLToPath(import.meta.url));
const protectedRules = new Set(["C5", "C7", "C9", "C16"]);

async function walk(path) {
  try {
    const output = [];
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name);
      if ((await stat(child)).isDirectory())
        output.push(...(await walk(child)));
      else if (/\.(ts|tsx|json|css)$/.test(name)) output.push(child);
    }
    return output;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function readDocuments(root) {
  const directories = [
    "apps/web/src/quills",
    "apps/web/src/routes/portal",
    "apps/web/src/routes/quills",
    teamRoutes,
    legacyTeamRoutes,
  ];
  const files = (
    await Promise.all(directories.map((p) => walk(join(root, p))))
  ).flat();
  let diagnostic = "";
  const capture = await mkdtemp(join(tmpdir(), "quills-web-ast-"));
  try {
    const sources = files.filter((p) => /\.tsx?$/.test(p));
    if (sources.length) {
      const result = spawnSync(
        join(root, "node_modules/.bin/vp"),
        ["lint", ...sources, "--no-error-on-unmatched-pattern"],
        {
          cwd: join(root, "scripts/quills-web"),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, QUILLS_WEB_AST_DIR: capture },
        },
      );
      if (result.error || result.status === null)
        throw new Error(
          `AST capture failed: ${result.error?.message ?? result.stderr}`,
        );
      diagnostic = `${result.stdout}\n${result.stderr}`;
      // Rule findings may make lint exit 1; missing ASTs still fail closed below.
    }
    const parsed = new Map();
    for (const file of await readdir(capture)) {
      const document = JSON.parse(await readFile(join(capture, file), "utf8"));
      parsed.set(resolve(root, document.filename), document.ast);
    }
    return await Promise.all(
      files.map(async (absolute) => {
        const file = relative(root, absolute).replaceAll("\\", "/");
        const code = await readFile(absolute, "utf8");
        const ast =
          parsed.get(absolute) ?? parsed.get(await realpath(absolute));
        if (/\.tsx?$/.test(file) && !ast)
          throw new Error(
            `No AST captured for ${file}; check syntax and the Vite+ capture rule. ${diagnostic}`,
          );
        const doc = {
          file,
          code,
          ast,
          nodes: ast ? nodes(ast) : [],
          kind: kindOf(file),
        };
        if (doc.kind === "meta") doc.meta = valueOf(declaration(doc, "meta"));
        return doc;
      }),
    );
  } finally {
    await rm(capture, { recursive: true, force: true });
  }
}

export async function inspectDocuments(root, documents, onlyRule) {
  const findings = [];
  const exceptions = new Map();
  for (const doc of documents) {
    const entries = [];
    const commentLines = new Set(
      (doc.ast?.comments ?? [])
        .filter((c) => c.type === "Line" || c.type === "LineComment")
        .map(
          (c) =>
            c.loc?.start?.line ??
            doc.code.slice(0, c.start ?? c.range?.[0] ?? 0).split("\n").length,
        ),
    );
    for (const [index, line] of doc.code.split("\n").entries()) {
      if (!commentLines.has(index + 1)) continue;
      if (!line.includes("quills-web-allow")) continue;
      const match =
        /^\s*\/\/ quills-web-allow (C(?:[1-9]|1[0-9]|2[0-3])):\s*(\S.*)$/.exec(
          line,
        );
      if (!match || protectedRules.has(match[1])) {
        findings.push({
          rule: match?.[1] ?? "C12",
          file: doc.file,
          line: index + 1,
          message:
            "Use a single-line exception with a reason; C5, C7, C9 and C16 cannot be waived.",
        });
      } else entries.push({ rule: match[1], line: index + 1 });
    }
    exceptions.set(doc.file, entries);
  }
  const report = (rule, doc, node, message) => {
    const offset = node?.start ?? node?.range?.[0];
    const line =
      typeof node === "number"
        ? node
        : node?.loc
          ? lineOf(node)
          : typeof offset === "number"
            ? doc.code.slice(0, offset).split("\n").length
            : 1;
    if (onlyRule && onlyRule !== rule) return;
    if (
      (exceptions.get(doc.file) ?? []).some((e) => {
        if (e.rule !== rule) return false;
        if (e.line === line || e.line + 1 === line) return true;
        if (rule !== "C19" || e.line >= line) return false;
        const between = doc.code
          .split("\n")
          .slice(e.line, line - 1)
          .join("\n")
          .trim();
        return /^(?:return\s*)?\(?\s*$/.test(between);
      })
    )
      return;
    findings.push({ rule, file: doc.file, line, message });
  };
  const openapi = JSON.parse(
    await readFile(join(root, "apps/docs/openapi.json"), "utf8"),
  );
  const operations = new Map();
  for (const [path, methods] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods))
      if (operation.operationId)
        operations.set(operation.operationId, { path, method, ...operation });
  }
  const context = {
    root,
    documents,
    operations,
    report,
    files: new Set(documents.map((d) => d.file)),
  };
  for (let id = 1; id <= 23; id++) {
    const rule = `C${id}`;
    if (onlyRule && rule !== onlyRule) continue;
    const module = await import(
      join(rulesDirectory, `${rule.toLowerCase()}.mjs`)
    );
    await module.check(context);
  }
  return findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
}

export async function checkConformance(root, onlyRule) {
  if (onlyRule && !/^C(?:[1-9]|1[0-9]|2[0-3])$/.test(onlyRule))
    throw new Error("Unknown conformance rule");
  return inspectDocuments(root, await readDocuments(root), onlyRule);
}
