import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DOCS_CARD_ICONS } from "@/components/docs/docs-mdx-components";
import { resolveDocsDir } from "../source";

// Better Auth mounts authentication routes directly under /api/auth/* outside
// the Hono OpenAPI specification generated for application routes.
const AUTH_ROUTES_OUTSIDE_OPENAPI = new Set([
  "POST /auth/update-user",
  "POST /auth/admin/update-user",
  "POST /auth/oauth2/backchannel-logout/custom",
]);

function normalizeApiDocPath(rawPath: string): string {
  const withoutPrefix = rawPath.startsWith("/api/")
    ? rawPath.slice("/api".length)
    : rawPath;
  return withoutPrefix.replace(/\/[A-Z][A-Z0-9_]+(?=\/|$)/g, "/{param}");
}

function normalizeOpenApiPath(specPath: string): string {
  return specPath.replace(/\{[^}]+\}/g, "{param}");
}

describe("docs coverage guards", () => {
  it("documents only API endpoints present in apps/docs/openapi.json (or known auth routes)", () => {
    const docsDir = resolveDocsDir();
    const spec = JSON.parse(
      readFileSync(path.join(docsDir, "openapi.json"), "utf8"),
    ) as {
      paths?: Record<string, Record<string, unknown>>;
    };

    const availableEndpoints = new Set<string>();
    for (const [specPath, operations] of Object.entries(spec.paths ?? {})) {
      const normalizedPath = normalizeOpenApiPath(specPath);
      for (const method of Object.keys(operations)) {
        availableEndpoints.add(`${method.toUpperCase()} ${normalizedPath}`);
      }
    }

    const apiRefDir = path.join(docsDir, "api-reference");
    const mdxFiles = readdirSync(apiRefDir)
      .filter((name) => name.endsWith(".mdx"))
      .sort();

    expect(mdxFiles.length).toBeGreaterThan(0);

    for (const fileName of mdxFiles) {
      const content = readFileSync(path.join(apiRefDir, fileName), "utf8");
      for (const match of content.matchAll(
        /`(GET|POST|PUT|PATCH|DELETE)\s+(\/[^`\s]+)`/g,
      )) {
        const method = match[1];
        const normalizedPath = normalizeApiDocPath(match[2]);
        const key = `${method} ${normalizedPath}`;
        if (AUTH_ROUTES_OUTSIDE_OPENAPI.has(key)) continue;
        expect(
          availableEndpoints.has(key),
          `Endpoint "${method} ${match[2]}" documented in api-reference/${fileName} was not found in openapi.json (normalized: ${key})`,
        ).toBe(true);
      }
    }
  });

  it("registers every <Card icon=...> used in apps/docs/**/*.mdx in DOCS_CARD_ICONS", () => {
    const docsDir = resolveDocsDir();
    const usedIcons = new Set<string>();

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "endpoints") continue;
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
          const content = readFileSync(full, "utf8");
          for (const match of content.matchAll(
            /<Card\b[^>]*\bicon=["']([^"']+)["']/g,
          )) {
            usedIcons.add(match[1]);
          }
        }
      }
    }

    walk(docsDir);
    expect(usedIcons.size).toBeGreaterThan(0);

    for (const icon of usedIcons) {
      expect(
        Object.hasOwn(DOCS_CARD_ICONS, icon),
        `Missing Lucide icon mapping for <Card icon="${icon}"> in docs-mdx-components.tsx`,
      ).toBe(true);
    }
  });
});
