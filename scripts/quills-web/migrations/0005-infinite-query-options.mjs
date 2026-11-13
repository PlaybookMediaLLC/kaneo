import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { operationNames } from "../lib/naming.mjs";
import { resolveSchema } from "../lib/openapi.mjs";
import { renderTemplate } from "../lib/template.mjs";

export async function migrate(root) {
  const document = JSON.parse(
    await readFile(join(root, "apps/docs/openapi.json"), "utf8"),
  );
  const changed = [];
  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const operation of Object.values(methods)) {
      if (!operation.operationId) continue;
      const names = operationNames(operation.operationId);
      const response = Object.entries(operation.responses ?? {}).find(
        ([status]) => /^2\d\d$/.test(status),
      )?.[1];
      const properties =
        resolveSchema(document, response?.content?.["application/json"]?.schema)
          .properties ?? {};
      const paging = [
        {
          parameter: "offset",
          field: "nextOffset",
          initial: "0",
          type: "number",
          value: "String(pageParam)",
          sample: "20",
        },
        {
          parameter: "cursor",
          field: "nextCursor",
          initial: "undefined",
          type: "string | undefined",
          value: "pageParam",
          sample: '"cursor_test_2"',
        },
      ].find(
        ({ parameter, field }) =>
          properties[field] &&
          operation.parameters?.some(
            (item) => item.in === "query" && item.name === parameter,
          ),
      );
      if (!paging) continue;
      const hookMatches = [];
      let areas;
      try {
        areas = await readdir(join(root, "apps/web/src/quills/hooks"), {
          withFileTypes: true,
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        areas = [];
      }
      for (const area of areas) {
        if (!area.isDirectory()) continue;
        const hook = join(
          root,
          "apps/web/src/quills/hooks",
          area.name,
          `use-${names.file}.ts`,
        );
        try {
          await readFile(hook, "utf8");
          hookMatches.push({ area: area.name, hook });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      for (const { area, hook } of hookMatches) {
        const operationFile = join(
          root,
          "apps/web/src/quills/api",
          area,
          `${names.file}.ts`,
        );
        let operationSource = await readFile(operationFile, "utf8");
        if (!operationSource.includes(`${names.name}InfiniteQuery`)) {
          operationSource = operationSource
            .replace(
              'import { queryOptions } from "@tanstack/react-query";',
              'import { infiniteQueryOptions, queryOptions, type InfiniteData } from "@tanstack/react-query";',
            )
            .trimEnd();
          operationSource += `\n${await renderTemplate(root, "operation/infinite-query-options.ts.txt.tpl", { NAME: names.name, PASCAL: names.pascal, PAGE_TYPE: paging.type, INITIAL_PAGE: paging.initial, PAGE_PARAMETER: paging.parameter, PAGE_VALUE: paging.value, NEXT_FIELD: paging.field })}`;
          await writeFile(
            operationFile,
            operationSource.endsWith("\n")
              ? operationSource
              : `${operationSource}\n`,
          );
          changed.push(relative(root, operationFile));
        }
        const required = [
          ...[...path.matchAll(/\{([^}]+)\}/g)].map(
            (match) => `input.param.${match[1]}`,
          ),
          ...(operation.parameters ?? [])
            .filter((item) => item.required && item.in === "query")
            .map((item) => `input.query.${item.name}`),
        ].join(" && ");
        const expectedHook = await renderTemplate(
          root,
          "operation/paged-hook.ts.tpl",
          {
            NAME: names.name,
            PASCAL: names.pascal,
            AREA_RAW: area,
            FILE: names.file,
            REQUIRED: required,
          },
        );
        if ((await readFile(hook, "utf8")) !== expectedHook) {
          await writeFile(
            hook,
            expectedHook.endsWith("\n") ? expectedHook : `${expectedHook}\n`,
          );
          changed.push(relative(root, hook));
        }
        const testFile = `${hook.slice(0, -3)}.test.tsx`;
        try {
          const testSource = await readFile(testFile, "utf8");
          if (!testSource.includes("paged:")) {
            await writeFile(
              testFile,
              testSource.replace(
                /(\s+invalidates:\s*\[[^\n]*\],)/,
                `$1\n    paged: { cursor: ${paging.sample} },`,
              ),
            );
            changed.push(relative(root, testFile));
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
  return changed;
}
