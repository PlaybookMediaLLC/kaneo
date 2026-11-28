#!/usr/bin/env node
/**
 * Expand-only migration linter (#303).
 *
 * Ensures new SQL migrations in `apps/api/drizzle/` and `apps/api/drizzle/quills/`
 * do not drop/rename tables or columns or narrow column types in the same release,
 * preserving rollback compatibility to the previous app image.
 *
 * Explicit contract-phase migrations (one release after code stops reading a column)
 * must include the marker comment `-- expand-contract: allow-contract`.
 */
import fs from "node:fs";
import path from "node:path";

const DESTRUCTIVE_PATTERNS = [
  { name: "DROP TABLE", regex: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", regex: /\bDROP\s+COLUMN\b/i },
  { name: "ALTER COLUMN TYPE", regex: /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
  { name: "RENAME COLUMN", regex: /\bRENAME\s+COLUMN\b/i },
  { name: "RENAME TO", regex: /\bALTER\s+TABLE\b[^;]*\bRENAME\s+TO\b/i },
];

export function checkExpandOnlySql(sql, filePath) {
  if (sql.includes("-- expand-contract: allow-contract")) {
    return [];
  }
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const violations = [];
  for (const { name, regex } of DESTRUCTIVE_PATTERNS) {
    if (regex.test(stripped)) {
      violations.push(
        `${filePath}: destructive SQL (${name}) violates expand-only rollback safety. Add "-- expand-contract: allow-contract" only for a delayed contract release.`,
      );
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: check-expand-only.mjs <migration.sql> [...]");
    process.exit(2);
  }
  const allViolations = [];
  for (const file of files) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs) || !abs.endsWith(".sql")) continue;
    const content = fs.readFileSync(abs, "utf8");
    allViolations.push(...checkExpandOnlySql(content, file));
  }
  if (allViolations.length > 0) {
    for (const v of allViolations) console.error(v);
    process.exit(1);
  }
  console.log(`✓ Expand-only migration check passed (${files.length} file(s))`);
}
