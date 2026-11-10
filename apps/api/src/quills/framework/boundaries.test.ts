import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Static import rules for src/quills/**. Tests and fixtures are test support and are not scanned.
const sources = (dir: string) => {
  const root = fileURLToPath(new URL(dir, import.meta.url));
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({
      path: file.replaceAll("\\", "/"),
      source: readFileSync(`${root}/${file}`, "utf8"),
    }));
};
const quills = sources("..").filter(
  (file) => !/\.(test|fixture)\.ts$/.test(file.path),
);
const feature = quills.filter((file) => !file.path.startsWith("framework/"));
// A router that only composes route modules follows the same import rules.
const routeModules = feature.filter(
  (file) =>
    file.source.includes("/framework/define-route") ||
    file.source.includes("apiRouter"),
);
const routePaths = new Set(
  routeModules.map((file) => file.path.replace(/(\/index)?\.ts$/, "")),
);
/** Route modules import packages, the helper, platform reads, Quills schema and other route modules only. */
const allowedImport = (file: string, specifier: string) => {
  if (
    /^(drizzle-orm|hono\/http-exception|@kaneo\/(ids|ids\/zod|branding))$/.test(
      specifier,
    )
  )
    return true;
  // "./directory/index" and "./directory" name the same module.
  const target = posix
    .join(posix.dirname(file), specifier)
    .replace(/\/index$/, "");
  return (
    specifier.startsWith(".") &&
    (routePaths.has(target) ||
      [
        "framework/define-route",
        "framework/files",
        "framework/integration-config",
        "framework/platform-reads",
        "framework/webhook-config",
        "../openapi",
      ].includes(target) ||
      target.startsWith("../database/quills/schema/"))
  );
};
const matching = (files: typeof quills, rule: RegExp) =>
  files
    .filter((file) => rule.test(file.source))
    .map((file) => file.path)
    .sort();

describe("Quills module boundaries", () => {
  it("declares every route through defineQuillsRoute", () => {
    expect(routeModules.length).toBeGreaterThan(0);
    expect(matching(feature, /\bcreateRoute\b/)).toEqual([]);
  });

  it("keeps route modules away from wider database paths and external effects", () => {
    expect(
      routeModules.flatMap((file) =>
        [...file.source.matchAll(/from "([^"]+)"|import\("([^"]+)"\)/g)]
          .map((match) => (match[1] ?? match[2])!)
          .filter((specifier) => !allowedImport(file.path, specifier))
          .map((specifier) => `${file.path}: ${specifier}`),
      ),
    ).toEqual([]);
  });

  it("does not spread request bodies into writes", () => {
    expect(
      matching(
        routeModules,
        /\.\.\.\s*(\w+\.)?body\b|\.(values|set)\(\s*(\w+\.)?body\b/,
      ),
    ).toEqual([]);
  });

  it("reads public tables only through trusted modules", () => {
    expect(
      matching(quills, /from "(\.\.\/)+database(\/index|\/schema)?"/),
    ).toEqual([
      // Test harness: seeds the platform rows that the contract checks need.
      "framework/contract.ts",
      // Storage lifecycle: the shared verification lease in public.job_lease.
      "framework/files.ts",
      "framework/platform-reads.ts",
      // Trusted maintenance: cache delivery and retention, not request paths.
      "jobs/retention.ts",
      "jobs/worker.ts",
      // The request entry point: platform access and project checks.
      "with-quills-request.ts",
    ]);
  });

  it("does not manage connections, roles or row security in feature code", () => {
    expect(
      matching(
        feature,
        /from "pg"|getDatabasePool|SET (LOCAL )?ROLE|set_config|row_security/i,
      ),
    ).toEqual([
      // Operator import: a read-only client on the original Quackback database.
      "transfer/legacy-archive.ts",
    ]);
  });

  it("reuses board_projects and post_tasks for native links", () => {
    const tables = sources("../../database/quills/schema").flatMap((file) =>
      [...file.source.matchAll(/\.table\(\s*"([a-z_]+)"/g)].map(
        (match) => match[1]!,
      ),
    );
    expect(tables).toEqual(
      expect.arrayContaining(["board_projects", "post_tasks"]),
    );
    expect(
      tables.filter(
        (table) =>
          /_(projects|tasks)$/.test(table) &&
          !["board_projects", "post_tasks"].includes(table),
      ),
    ).toEqual([]);
  });
});
