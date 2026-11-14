import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

function sourceFiles(path: string): string[] {
  try {
    return readdirSync(path).flatMap((name) => {
      const child = resolve(path, name);
      return statSync(child).isDirectory()
        ? sourceFiles(child)
        : /\.(ts|tsx)$/.test(name)
          ? [child]
          : [];
    });
  } catch {
    return [];
  }
}

describe("Quills web import boundary", () => {
  it("uses the upstream adapter as the only upstream web import", () => {
    const web = resolve(import.meta.dirname, "..");
    const files = [
      ...sourceFiles(resolve(web, "quills")),
      ...sourceFiles(resolve(web, "routes/portal")),
      ...sourceFiles(resolve(web, "routes/quills")),
      ...sourceFiles(resolve(web, "routes/_layout/_authenticated/feedback")),
      ...sourceFiles(
        resolve(
          web,
          "routes/_layout/_authenticated/dashboard/workspace/$workspaceId/quills",
        ),
      ),
    ];
    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith("quills/ui/upstream.ts")) continue;
      const route = file.includes("/routes/");
      for (const match of readFileSync(file, "utf8").matchAll(
        /from\s+["'](@\/[^"']+)["']/g,
      )) {
        if (!(route && match[1].startsWith("@/quills/")))
          violations.push(`${file}: ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
