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
const routeModules = feature.filter((file) =>
  file.source.includes("/framework/define-route"),
);
const routePaths = new Set(
  routeModules.map((file) => file.path.replace(/\.ts$/, "")),
);
/** Route modules import packages, the helper, platform reads, Quills schema and other route modules only. */
const allowedImport = (file: string, specifier: string) => {
  if (
    /^(drizzle-orm|hono\/http-exception|@kaneo\/(ids|ids\/zod|branding))$/.test(
      specifier,
    )
  )
    return true;
  const target = posix.join(posix.dirname(file), specifier);
  return (
    specifier.startsWith(".") &&
    (routePaths.has(target) ||
      [
        "framework/define-route",
        "framework/platform-reads",
        "framework/audience",
        "../openapi",
      ].includes(target) ||
      target.startsWith("../database/quills/schema/"))
  );
};
/**
 * Portal, widget and public route modules reach the database only through withQuillsAudience
 * (inside defineQuillsRoute). Each finding names a teammate or wider path they use.
 */
const audienceViolations = (file: { path: string; source: string }) =>
  /audience:\s*"(portal|widget|public)"/.test(file.source)
    ? [
        ...file.source.matchAll(
          /(?:from |import\()"([^"]*(with-quills-request|platform-reads|database\/quills\/client|\/database(\/index)?))"|\b(withQuillsRequest|withQuillsWorkspace|withQuillsSystemWorkspace|getDatabasePool)\b/g,
        ),
      ].map((match) => `${file.path}: ${match[1] ?? match[4]}`)
    : [];
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

  it("keeps portal, widget and public routes off teammate and platform database paths", () => {
    const audienceModules = routeModules.filter((file) =>
      /audience:\s*"(portal|widget|public)"/.test(file.source),
    );
    expect(audienceModules.length).toBeGreaterThan(0);
    expect(routeModules.flatMap(audienceViolations)).toEqual([]);
    // The rule itself fires on each forbidden path.
    expect(
      audienceViolations({
        path: "broken.ts",
        source: [
          'audience: "portal",',
          'import { withQuillsRequest } from "../with-quills-request";',
          'import db from "../../database";',
          'const { isMemberOfNamedWorkspace } = await import("../framework/platform-reads");',
          "await withQuillsSystemWorkspace(id, work);",
        ].join("\n"),
      }),
    ).toEqual([
      "broken.ts: withQuillsRequest",
      "broken.ts: ../with-quills-request",
      "broken.ts: ../../database",
      "broken.ts: ../framework/platform-reads",
      "broken.ts: withQuillsSystemWorkspace",
    ]);
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
