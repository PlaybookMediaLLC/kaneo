#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { run as checkCommand } from "./commands/check.mjs";
import { run as doctorCommand } from "./commands/doctor.mjs";
import { run as listCommand } from "./commands/list.mjs";
import { run as migrateCommand } from "./commands/migrate.mjs";
import { run as seedCommand } from "./commands/seed.mjs";
import { run as verifyCommand } from "./commands/verify.mjs";
import { run as feature } from "./commands/feature.mjs";
import { run as query } from "./commands/query.mjs";
import { run as mutation } from "./commands/mutation.mjs";
import { run as type } from "./commands/type.mjs";
import { run as page } from "./commands/page.mjs";
import { run as component } from "./commands/component.mjs";
import { run as part } from "./commands/part.mjs";
import { run as form } from "./commands/form.mjs";
import { run as redirectCommand } from "./commands/redirect.mjs";
import { run as test } from "./commands/test.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [command, ...raw] = process.argv.slice(2);
const generateCommands = {
  feature,
  query,
  mutation,
  type,
  page,
  component,
  part,
  form,
  redirect: redirectCommand,
  test,
};

const optionSchema = Object.fromEntries(
  [
    "area",
    "invalidates",
    "optimistic",
    "from",
    "at",
    "path",
    "route",
    "audience",
    "feature",
    "operation",
    "operations",
    "search",
    "token",
    "variants",
    "poll",
    "rule",
    "kind",
  ].map((name) => [name, { type: "string" }]),
);
for (const name of [
  "paged",
  "mail-linked",
  "dry-run",
  "json",
  "list",
  "exceptions",
  "api",
  "reset",
])
  optionSchema[name] = { type: "boolean" };

function argumentsAndOptions(values) {
  const parsed = parseArgs({
    args: values,
    options: optionSchema,
    allowPositionals: true,
    strict: true,
  });
  const options = Object.fromEntries(
    Object.entries(parsed.values).map(([name, value]) => [
      name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );
  return { args: parsed.positionals, options };
}

const help = {
  feature: "feature <name>",
  query: "query <operationId> --area <area> [--paged] [--poll <seconds>]",
  mutation:
    "mutation <operationId> --area <area> --invalidates <operationId,...> [--optimistic <operationId>]",
  type: "type <area>/<Name> --from <operationId> --at <path>",
  page: "page <name> --route <path> --audience <audience> --feature <feature> --operations <operationId,...>",
  component: "component [<group>/]<Name> [--variants <a,b>]",
  part: "part <page>/<Name>",
  form: "form <page>/<Name> --operation <operationId>",
  redirect: "redirect <from> <to>",
  test: "test <file>",
};

async function check(options) {
  const findings = await checkCommand(root, [], options);
  for (const item of findings)
    console.error(`${item.rule} ${item.file}:${item.line} ${item.message}`);
  if (findings.length) process.exitCode = 1;
  else console.log("PASSED quills-web conformance");
  return findings;
}

async function list(options) {
  for (const line of await listCommand(root, [], options)) console.log(line);
}

async function main() {
  const { args, options } = argumentsAndOptions(raw);
  if (command === "help") {
    const usage = help[args[0]];
    if (!usage)
      throw new Error(`Usage: cli.mjs help <${Object.keys(help).join("|")}>`);
    console.log(
      `Usage: node scripts/quills-web/cli.mjs ${usage} [--dry-run] [--json]`,
    );
    console.log(
      `Example: node scripts/quills-web/cli.mjs ${usage.replace(/<[^>]+>/g, "sample").replace(/ \[[^\]]+\]/g, "")}`,
    );
    return;
  }
  if (options.dryRun) process.env.QUILLS_WEB_DRY_RUN = "1";
  let files = [];
  if (command in generateCommands)
    files = await generateCommands[command](root, args, options);
  else if (command === "check") return check(options);
  else if (command === "list") return list(options);
  else if (command === "migrate") {
    const changed = await migrateCommand(root, args, options);
    if (options.list) {
      for (const name of changed) console.log(name);
      return;
    }
    for (const file of changed) console.log(`MIGRATED ${file}`);
    return console.log(
      `PASSED framework migrations (${changed.length} files changed)`,
    );
  } else if (command === "doctor") {
    await doctorCommand(root, args, options);
    return console.log("PASSED Node, OpenAPI and conformance checks");
  } else if (command === "verify") return verifyCommand(root, args, options);
  else if (command === "seed") return seedCommand(root, args, options);
  else
    throw new Error(
      "Usage: cli.mjs <feature|query|mutation|type|page|component|part|form|redirect|test|check|list|migrate|doctor|verify|seed>",
    );
  if (options.json)
    console.log(
      JSON.stringify({
        files,
        dryRun: Boolean(options.dryRun),
        next: "node scripts/quills-web/cli.mjs check",
      }),
    );
  else {
    for (const file of files)
      console.log(`${options.dryRun ? "WOULD CREATE" : "CREATED"} ${file}`);
    if (files.length)
      console.log(
        `NEXT replace every ${"TODO(quills-web)"} marker, then run: node scripts/quills-web/cli.mjs check`,
      );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode =
    error.message.startsWith("Usage:") ||
    error.code?.startsWith("ERR_PARSE_ARGS")
      ? 2
      : 1;
});
