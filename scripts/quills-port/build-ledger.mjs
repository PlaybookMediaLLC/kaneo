#!/usr/bin/env node
// Builds the Quackback → Kaneo capability ledger.
//   node scripts/quills-port/build-ledger.mjs [path-to-quackback]
// Default source: ../quackback next to this repository, or $QUACKBACK_DIR.
// Output: docs/quills-port/ledger/{routes.csv,capabilities.csv,summary.md,phase-*.md}
// Exit code 1 when a completeness check fails.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTracer, tableDeclarations } from "./trace.mjs";
import {
  CAPABILITY_RULES,
  DOMAINS,
  READ_VERB,
  ROUTE_RULES,
  quillsAction,
} from "./rules.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quackback = resolve(
  process.argv[2] ?? process.env.QUACKBACK_DIR ?? join(repo, "../quackback"),
);
const out = join(repo, "docs/quills-port/ledger");
const overridesPath = join(out, "overrides.json");
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, "utf8"))
  : { routes: {}, capabilities: {} };

const tracer = createTracer(quackback);
const routesDir = join(tracer.src, "routes");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const isTest = (file) => /__tests__|\.test\./.test(file);
const kaneoTables = new Set(
  tableDeclarations(join(repo, "apps/api/src/database/quills/schema")).map(
    ([, sql]) => sql,
  ),
);
const IDENTITY_TABLES = new Set([
  "user",
  "session",
  "account",
  "invitation",
  "identity_provider",
  "sso_verified_domain",
  "sso_recovery_code",
  "verification",
  "two_factor",
  "one_time_token",
  "device_code",
  "jwks",
]);
const problems = [];

function domainFor(rules, key, override) {
  if (override?.domain) return override.domain;
  return rules.find(([pattern]) => pattern.test(key))?.[1] ?? null;
}

function audience(helpers, permissions) {
  const has = (name) => helpers.includes(name);
  if (has("verifySignature") || has("verifySlackSignature"))
    return "signed webhook";
  if (has("requireWidgetAuth") || has("getWidgetSession"))
    return "widget visitor";
  if (has("withApiKeyAuth") || has("requireApiKey") || has("requireTeamAuth"))
    return "teammate";
  if (has("requireAuth") && permissions.length) return "teammate";
  if (has("resolvePortalAccessForRequest") || has("getOptionalAuth"))
    return "portal (optional sign-in)";
  if (has("requireAuth")) return "signed-in principal";
  return "public or custom";
}

function kaneoStatus(disposition, tables) {
  if (disposition === "reuse Kaneo") return "exists";
  if (disposition !== "port") return "n/a";
  // Quackback's own auth tables are not copied. A capability that reads them crosses the
  // identity boundary: in Kaneo it reads the principal projection or the platform user.
  const identity = tables.filter(
    (table) => !kaneoTables.has(table) && IDENTITY_TABLES.has(table),
  );
  const missing = tables.filter(
    (table) => !kaneoTables.has(table) && !IDENTITY_TABLES.has(table),
  );
  if (missing.length) return `missing (no table: ${missing.join(" ")})`;
  if (identity.length)
    return `partial (identity boundary: source reads ${identity.join(" ")}; use Kaneo identity)`;
  return tables.length
    ? "partial (schema and RLS exist, no endpoint)"
    : "missing (no endpoint)";
}

const kebab = (text) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
const snake = (text) => kebab(text).replace(/-/g, "_");
const PAST = {
  create: "created",
  add: "added",
  update: "updated",
  set: "updated",
  save: "updated",
  delete: "deleted",
  remove: "removed",
  mark: "marked",
  assign: "assigned",
  unassign: "unassigned",
  merge: "merged",
  unmerge: "unmerged",
  approve: "approved",
  reject: "rejected",
  publish: "published",
  archive: "archived",
  restore: "restored",
  rotate: "rotated",
  revoke: "revoked",
  send: "sent",
  submit: "submitted",
  toggle: "updated",
  reorder: "reordered",
  move: "moved",
  block: "blocked",
  unblock: "unblocked",
  subscribe: "subscribed",
  unsubscribe: "unsubscribed",
  close: "closed",
  reopen: "reopened",
  accept: "accepted",
  dismiss: "dismissed",
  retry: "retried",
  link: "linked",
  unlink: "unlinked",
  vote: "voted",
  pin: "pinned",
  unpin: "unpinned",
};

function proposeForFunction(name, method, group) {
  const bare = name.replace(/Fn$/, "");
  const [, verb = "", rest = ""] = /^([a-z]+)(.*)$/.exec(bare) ?? [];
  const readOnly = method === "GET" || READ_VERB.test(bare);
  const http = readOnly
    ? "GET"
    : /^(delete|remove|revoke)/.test(verb)
      ? "DELETE"
      : /^(create|add|submit|send|import)/.test(verb)
        ? "POST"
        : "PATCH";
  const resource = kebab(rest || bare);
  return {
    readOnly,
    operationId: `${verb || "call"}Quills${rest || bare.charAt(0).toUpperCase() + bare.slice(1)}`,
    endpoint: `${http} /quills/{workspaceId}/${group}/${resource}`,
    event: readOnly
      ? ""
      : `${snake(rest || bare)}.${PAST[verb] ?? `${verb}_done`}`,
    verbName: bare,
  };
}

function proposeForHandler(url, method, group) {
  const path = url
    .replace(/^\/api\/v1/, "")
    .replace(/^\/api/, "")
    .replace(/\$([A-Za-z]+)/g, "{$1}")
    .replace(/\/$/, "");
  const words = path
    .split("/")
    .filter((part) => part && !part.startsWith("{"))
    .map((part) =>
      part.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ?? "").toUpperCase()),
    );
  const verb =
    {
      GET: path.endsWith("}") ? "get" : "list",
      POST: "create",
      PATCH: "update",
      PUT: "put",
      DELETE: "delete",
    }[method] ?? "call";
  const noun = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  const readOnly = method === "GET";
  return {
    readOnly,
    operationId: `${verb}Quills${noun}`,
    endpoint: `${method} /quills/{workspaceId}${path}`,
    event: readOnly
      ? ""
      : `${snake(words.at(-1) ?? group)}.${PAST[verb] ?? `${verb}_done`}`,
    verbName: verb,
  };
}

function testProfile(capability) {
  if (capability.disposition !== "port") return "";
  const tests = ["contract"];
  if (capability.tables.length) tests.push("two-workspace");
  tests.push(capability.readOnly ? "read-leak" : "rollback");
  if (
    capability.tables.some((table) =>
      /board_projects|post_tasks|^teams$/.test(table),
    )
  )
    tests.push("native-link");
  if (
    capability.effects.some((effect) =>
      /email|webhooks|jobs|integrations|notifications/.test(effect),
    )
  )
    tests.push("worker-retry");
  if (capability.effects.includes("storage")) tests.push("storage-lifecycle");
  if (!/teammate/.test(capability.audience)) tests.push("audience");
  return tests.join(" ");
}

// ---- 1. capabilities: every server function and every HTTP handler ----
const capabilities = new Map();
const operationIds = new Map();
function addCapability(id, type, source, facts, domain, proposal, override) {
  if (!domain) problems.push(`capability without a domain rule: ${id}`);
  const spec = DOMAINS[domain] ?? { disposition: "", phase: "?" };
  const permissions = [...facts.permissions].sort();
  const helpers = [...facts.helpers].sort();
  const row = {
    id,
    type,
    source,
    domain: domain ?? "",
    phase: spec.phase,
    disposition: override?.disposition ?? spec.disposition,
    reason: override?.reason ?? spec.reason ?? "",
    audience: audience(helpers, permissions),
    permissions,
    helpers,
    tables: [...facts.tables].sort(),
    effects: [...facts.effects].sort(),
    calls: [...facts.capabilities].sort(),
    usedBy: 0,
    mergedInto: override?.mergedInto ?? "",
    // Who built it, for example "RFC 0001 lane M1". Empty while it is open.
    closed: override?.closed ?? "",
    ...proposal,
  };
  row.action =
    row.disposition === "port"
      ? quillsAction(row.verbName, permissions, row.readOnly)
      : "";
  row.kaneoStatus = kaneoStatus(row.disposition, row.tables);
  if (row.disposition !== "port")
    row.operationId = row.endpoint = row.event = "";
  else {
    const clash = operationIds.get(row.operationId);
    if (clash)
      row.operationId += basename(source)
        .replace(/\.tsx?$/, "")
        .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ?? "").toUpperCase())
        .replace(/^./, (c) => c.toUpperCase());
    operationIds.set(row.operationId, id);
    // The operation that closed it, when it differs from the proposal.
    if (override?.operationId) row.operationId = override.operationId;
  }
  row.tests = testProfile(row);
  capabilities.set(id, row);
}

for (const file of walk(tracer.src)
  .filter((name) => /\.tsx?$/.test(name) && !isTest(name))
  .sort()) {
  const source = relative(tracer.src, file);
  for (const fn of tracer.serverFunctions(file)) {
    const id = `${source}#${fn.name}`;
    const override = overrides.capabilities?.[id];
    const domain = domainFor(CAPABILITY_RULES, id, override);
    addCapability(
      id,
      "server function",
      source,
      tracer.trace({ file, name: fn.name }),
      domain,
      proposeForFunction(fn.name, fn.method, DOMAINS[domain]?.group ?? ""),
      override,
    );
  }
}

// ---- 2. routes: one row per file under routes/ ----
const routes = [];
function urlFromFile(path) {
  return `/${path
    .replace(/\.tsx?$/, "")
    .split(/[/.]/)
    .filter((part) => part !== "index" && !part.startsWith("_"))
    .map((part) => part.replace(/_$/, ""))
    .join("/")}`.replace(/\[\/\]/g, ".");
}
for (const file of walk(routesDir).sort()) {
  const path = relative(routesDir, file);
  const key = path.replace(/__tests__\//g, "").replace(/\.test(?=\.tsx?$)/, "");
  const override = overrides.routes?.[path];
  const domain = domainFor(ROUTE_RULES, key, override);
  if (!domain) problems.push(`route without a domain rule: ${path}`);
  const spec = DOMAINS[domain] ?? { disposition: "", phase: "?" };
  const row = {
    path,
    closed: override?.closed ?? "",
    domain: domain ?? "",
    phase: spec.phase,
    url: "",
    methods: [],
    capabilities: [],
    tables: [],
    permissions: [],
    effects: [],
    helpers: [],
  };
  if (isTest(file)) {
    row.kind = "test";
    row.disposition =
      override?.disposition ??
      (spec.disposition === "port" ? "port" : spec.disposition);
    row.reason =
      override?.reason ??
      (spec.disposition === "port"
        ? "Test of a ported capability. Port its assertions as endpoint tests in the same phase."
        : `Test of a capability that is not ported. ${spec.reason ?? ""}`);
    row.audience = "";
  } else {
    const info = tracer.load(file);
    const facts = tracer.trace({ file, all: true });
    const hasServer =
      /\bserver:\s*\{/.test(info.text) || info.handlers.length > 0;
    row.kind = basename(file).startsWith("-")
      ? "helper"
      : hasServer
        ? "api"
        : "page";
    row.url =
      row.kind === "helper" ? "" : (info.routePath ?? urlFromFile(path));
    row.methods = info.handlers.map((handler) => handler.method);
    if (row.kind === "api" && !row.methods.length)
      row.methods = ["(delegated)"];
    row.tables = [...facts.tables].sort();
    row.permissions = [...facts.permissions].sort();
    row.effects = [...facts.effects].sort();
    row.helpers = [...facts.helpers].sort();
    row.audience =
      row.kind === "api" ? audience(row.helpers, row.permissions) : "";
    row.capabilities = [...facts.capabilities].sort();
    if (row.kind === "api") {
      const handlers = info.handlers.length
        ? info.handlers
        : [{ method: "*", all: true }];
      for (const handler of handlers) {
        const id = `routes/${path}#${handler.method}`;
        const handlerFacts = handler.all
          ? facts
          : tracer.trace({ file, node: handler });
        addCapability(
          id,
          "http handler",
          `routes/${path}`,
          handlerFacts,
          domain,
          proposeForHandler(
            row.url,
            handler.method === "*" ? "GET" : handler.method,
            spec.group ?? "",
          ),
          overrides.capabilities?.[id],
        );
        // A closed route file closes its handlers.
        if (override?.closed) capabilities.get(id).closed ||= override.closed;
        row.capabilities.push(id);
      }
    }
    const ported = row.capabilities.filter(
      (id) => capabilities.get(id)?.disposition === "port",
    );
    if (override?.disposition) row.disposition = override.disposition;
    else if (
      row.kind === "page" &&
      spec.disposition === "port" &&
      !ported.length
    )
      row.disposition = "UI-only";
    else row.disposition = spec.disposition;
    row.reason =
      override?.reason ??
      (row.disposition === "UI-only" && spec.disposition === "port"
        ? "Layout, redirect or static page. It reaches no ported server capability."
        : row.disposition === "port"
          ? row.kind === "page"
            ? `Closes when its ${ported.length} server capabilities are ported.`
            : row.kind === "helper"
              ? "Shared serializer or validator. Its rules move into the route declarations of this domain."
              : "HTTP handler. Port as a declared Quills route."
          : (spec.reason ?? ""));
  }
  row.kaneoStatus =
    row.kind === "test"
      ? row.disposition === "port"
        ? "missing (no endpoint test)"
        : "n/a"
      : row.disposition === "UI-only"
        ? "n/a"
        : kaneoStatus(row.disposition, row.tables);
  if (!row.disposition) problems.push(`route without a disposition: ${path}`);
  if (row.disposition === "out of scope" && !row.reason)
    problems.push(`out of scope without a reason: ${path}`);
  for (const id of row.capabilities)
    if (capabilities.has(id)) capabilities.get(id).usedBy += 1;
  routes.push(row);
}

// An override must name a row that exists, or a typo would leave a built row open.
for (const id of Object.keys(overrides.capabilities ?? {}))
  if (!capabilities.has(id))
    problems.push(`override for an unknown capability: ${id}`);
for (const path of Object.keys(overrides.routes ?? {}))
  if (!routes.some((row) => row.path === path))
    problems.push(`override for an unknown route file: ${path}`);

// ---- 3. write ----
mkdirSync(out, { recursive: true });
const cell = (value) => {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = (columns, rows) =>
  `${[columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\n")}\n`;
const serverFunctionsOf = (row) =>
  row.capabilities.filter(
    (id) =>
      !id.startsWith("routes/") ||
      (id.includes("#") && !/#(GET|POST|PUT|PATCH|DELETE|\*)$/.test(id)),
  );
writeFileSync(
  join(out, "routes.csv"),
  csv(
    [
      "path",
      "kind",
      "url",
      "methods",
      "audience",
      "serverFunctions",
      "tables",
      "permissions",
      "effects",
      "kaneoStatus",
      "disposition",
      "reason",
      "domain",
      "phase",
      "closed",
    ],
    routes.map((row) => ({
      ...row,
      serverFunctions: serverFunctionsOf(row).map((id) =>
        id.replace("lib/server/functions/", ""),
      ),
    })),
  ),
);
const capabilityRows = [...capabilities.values()].sort(
  (a, b) =>
    a.phase.localeCompare(b.phase) ||
    a.domain.localeCompare(b.domain) ||
    a.id.localeCompare(b.id),
);
writeFileSync(
  join(out, "capabilities.csv"),
  csv(
    [
      "id",
      "type",
      "audience",
      "permissions",
      "helpers",
      "tables",
      "effects",
      "usedBy",
      "kaneoStatus",
      "disposition",
      "reason",
      "domain",
      "phase",
      "operationId",
      "endpoint",
      "action",
      "event",
      "tests",
      "mergedInto",
      "closed",
    ],
    capabilityRows,
  ),
);

const count = (rows, key) =>
  rows.reduce(
    (acc, row) => ((acc[row[key]] = (acc[row[key]] ?? 0) + 1), acc),
    {},
  );
const table = (head, rows) =>
  [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
const phases = [
  ...new Set(Object.values(DOMAINS).map((domain) => domain.phase)),
]
  .filter((phase) => phase !== "-")
  .sort();
for (const phase of phases) {
  const rows = capabilityRows.filter(
    (row) => row.phase === phase && row.disposition === "port",
  );
  const routeRows = routes.filter(
    (row) => row.phase === phase && row.disposition !== "UI-only",
  );
  writeFileSync(
    join(out, `phase-${phase}.md`),
    [
      `# ${phase} endpoint plan (generated)`,
      "",
      "Generated by `scripts/quills-port/build-ledger.mjs`. Do not edit. Change `rules.mjs` or `overrides.json`.",
      "The operationId is the stable key. The path, the action and the event are proposals; the phase kickoff review fixes them.",
      "",
      `Ledger rows closed by this phase: ${routeRows.length} route files. Endpoints: ${rows.length}.`,
      "",
      ...[...new Set(rows.map((row) => row.domain))].flatMap((domain) => [
        `## ${domain}`,
        "",
        table(
          [
            "operationId",
            "Proposed route",
            "Action",
            "Audience",
            "Source permission",
            "Tables",
            "Outbox event",
            "Side effects",
            "Tests",
            "Source",
          ],
          rows
            .filter((row) => row.domain === domain)
            .map((row) => [
              `\`${row.operationId}\``,
              `\`${row.endpoint}\``,
              row.action,
              row.audience,
              row.permissions.join(" ") || "-",
              row.tables.join(" ") || "-",
              row.event ? `\`${row.event}\`` : "-",
              row.effects.join(" ") || "-",
              row.tests,
              `\`${row.id.replace("lib/server/functions/", "")}\``,
            ]),
        ),
        "",
      ]),
    ].join("\n"),
  );
}

let sourceCommit = "unknown";
try {
  sourceCommit = execFileSync("git", ["-C", quackback, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {}
const fileCount = walk(routesDir).length;
if (routes.length !== fileCount)
  problems.push(
    `row count ${routes.length} differs from route file count ${fileCount}`,
  );
const dispositions = count(routes, "disposition");
const ported = capabilityRows.filter((row) => row.disposition === "port");
const orphans = capabilityRows.filter(
  (row) => row.type === "server function" && row.usedBy === 0,
);
writeFileSync(
  join(out, "summary.md"),
  [
    "# Capability ledger summary (generated)",
    "",
    `Source: Quackback \`${sourceCommit}\`. Rerun: \`node scripts/quills-port/build-ledger.mjs <quackback dir>\`.`,
    "",
    "## Completeness checks",
    "",
    table(
      ["Check", "Result"],
      [
        ["Route files under `apps/web/src/routes`", String(fileCount)],
        ["Rows in `routes.csv`", String(routes.length)],
        [
          "Rows without a disposition",
          String(routes.filter((row) => !row.disposition).length),
        ],
        [
          "Out-of-scope rows without a reason",
          String(
            routes.filter(
              (row) => row.disposition === "out of scope" && !row.reason,
            ).length,
          ),
        ],
        [
          "Server functions found (`createServerFn`)",
          String(
            capabilityRows.filter((row) => row.type === "server function")
              .length,
          ),
        ],
        [
          "HTTP handlers found (route file × method)",
          String(
            capabilityRows.filter((row) => row.type === "http handler").length,
          ),
        ],
        [
          "Capabilities without a domain",
          String(capabilityRows.filter((row) => !row.domain).length),
        ],
        [
          "Capabilities closed (`overrides.json`)",
          String(capabilityRows.filter((row) => row.closed).length),
        ],
        [
          "Ported capabilities not marked closed",
          String(ported.filter((row) => !row.closed).length),
        ],
        [
          "Route files closed (`overrides.json`)",
          String(routes.filter((row) => row.closed).length),
        ],
        [
          "Server functions that no route file reaches",
          `${orphans.length} (each still has a disposition)`,
        ],
        [
          "Ported capabilities that use a table Kaneo does not have",
          String(
            ported.filter((row) =>
              row.kaneoStatus.startsWith("missing (no table"),
            ).length,
          ),
        ],
        [
          "Ported capabilities that cross the identity boundary (source reads its own auth tables)",
          String(
            ported.filter((row) =>
              row.kaneoStatus.includes("identity boundary"),
            ).length,
          ),
        ],
      ],
    ),
    "",
    problems.length
      ? `**FAILED:**\n\n${problems.map((problem) => `- ${problem}`).join("\n")}`
      : "**All checks pass.**",
    "",
    "## Route files by disposition",
    "",
    table(["Disposition", "Route files"], Object.entries(dispositions).sort()),
    "",
    "## Route files by kind",
    "",
    table(
      ["Kind", "Route files"],
      Object.entries(count(routes, "kind")).sort(),
    ),
    "",
    "## Phases",
    "",
    table(
      [
        "Phase",
        "Domains",
        "Route files closed",
        "Endpoints to build",
        "Read",
        "Mutation",
        "Not teammate audience",
        "With external effects",
      ],
      phases.map((phase) => {
        const rows = ported.filter((row) => row.phase === phase);
        return [
          phase,
          [...new Set(rows.map((row) => row.domain))].join(", ") || "-",
          routes.filter(
            (row) => row.phase === phase && row.disposition === "port",
          ).length,
          rows.length,
          rows.filter((row) => row.readOnly).length,
          rows.filter((row) => !row.readOnly).length,
          rows.filter((row) => !/teammate/.test(row.audience)).length,
          rows.filter((row) =>
            row.effects.some((effect) =>
              /email|webhooks|jobs|integrations/.test(effect),
            ),
          ).length,
        ];
      }),
    ),
    "",
    "## Capabilities not ported",
    "",
    table(
      ["Domain", "Disposition", "Capabilities", "Reason"],
      Object.entries(DOMAINS)
        .filter(([, spec]) => spec.disposition !== "port")
        .map(([name, spec]) => [
          name,
          spec.disposition,
          capabilityRows.filter((row) => row.domain === name).length,
          spec.reason,
        ]),
    ),
    "",
    "## Tables",
    "",
    `Quackback tables referenced by ported capabilities: ${new Set(ported.flatMap((row) => row.tables)).size}. Kaneo \`quills\` tables: ${kaneoTables.size}.`,
    "",
    `Referenced but absent in Kaneo: ${
      [...new Set(ported.flatMap((row) => row.tables))]
        .filter((name) => !kaneoTables.has(name))
        .sort()
        .join(", ") || "none"
    }. These are the source's auth tables. Kaneo owns identity, so they are not copied.`,
    "",
    "## Limits of the trace",
    "",
    "- The trace follows identifiers through imports. A page row lists every server function its component tree can reach, so layout pages list many.",
    "- The walk stops at the events, jobs, email, integrations, realtime and storage modules and records them as side effects.",
    "- Permission keys come from `PERMISSIONS.X` in reached server code. A dynamic check does not appear.",
    "- `audience` comes from the auth helper names. `public or custom` means that no known helper was found; review these rows first.",
    "",
  ].join("\n"),
);

console.log(
  `routes ${routes.length}/${fileCount}  capabilities ${capabilityRows.length}  ported ${ported.length}  problems ${problems.length}`,
);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(problems.length ? 1 : 0);
