import {
  defaultForSchema,
  endpointExpression,
  findOperation,
  readOpenApi,
  resolveSchema,
  zodForSchema,
} from "./openapi.mjs";
import { kebab, operationNames, pascal } from "./naming.mjs";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addSortedJsonKeys,
  assertNewPaths,
  formatGenerated,
  writeNew,
} from "./files.mjs";
import { renderTemplate } from "./template.mjs";

const marker = "TODO(quills-web)";

function sampleValue(name, schema = {}) {
  if (schema.enum) return schema.enum[0];
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 1;
  if (schema.type === "boolean") return false;
  if (name === "workspace" || name === "workspaceId") return "workspace_test_1";
  if (name.toLowerCase().includes("token")) return "mail_link_value";
  if (name.toLowerCase().includes("locale")) return "en-US";
  if (name.toLowerCase().endsWith("id")) return `${kebab(name)}_test_1`;
  return "value";
}

export async function generateFeature(root, name) {
  if (!name || kebab(name) !== name)
    throw new Error("Feature name must be lowercase kebab-case");
  const file = `${root}/apps/web/src/quills/i18n/en-US/${kebab(name)}.json`;
  await assertNewPaths(root, [file]);
  const output = [
    await writeNew(
      root,
      file,
      await renderTemplate(root, "feature/resource.json.tpl", {}),
    ),
  ];
  formatGenerated([file]);
  return output;
}

export async function generateOperation(root, kind, operationId, options) {
  if (!options.area) throw new Error("--area is required");
  if (
    options.poll &&
    (!Number.isFinite(Number(options.poll)) || Number(options.poll) < 10)
  )
    throw new Error("--poll must be at least 10 seconds");
  if (options.paged && kind !== "query")
    throw new Error("--paged applies only to a query");
  if (options.optimistic && kind !== "mutation")
    throw new Error("--optimistic applies only to a mutation");
  if (kind === "mutation" && !options.invalidates)
    throw new Error("--invalidates is required for a mutation");
  const names = operationNames(operationId);
  const area = kebab(options.area);
  const document = await readOpenApi(root);
  const found = findOperation(document, operationId);
  for (const target of options.invalidates?.split(",").filter(Boolean) ?? [])
    findOperation(document, target);
  if (options.optimistic) findOperation(document, options.optimistic);
  const endpoint = endpointExpression(found.path, found.method);
  const pathParams = [...found.path.matchAll(/\{([^}]+)\}/g)].map(
    (match) => match[1],
  );
  const workspaceParam = pathParams.find(
    (name) => name === "workspace" || name === "workspaceId",
  );
  if (!workspaceParam)
    throw new Error(`${operationId} has no workspace path parameter`);
  const required = [
    ...pathParams.map((name) => `input.param.${name}`),
    ...(found.operation.parameters ?? [])
      .filter((parameter) => parameter.required && parameter.in === "query")
      .map((parameter) => `input.query.${parameter.name}`),
  ];
  const successStatus = Number(
    Object.keys(found.operation.responses ?? {}).find((status) =>
      /^2\d\d$/.test(status),
    ) ?? 200,
  );
  const successSchema =
    found.operation.responses?.[successStatus]?.content?.["application/json"]
      ?.schema;
  const fixtureBody = successSchema
    ? defaultForSchema(document, successSchema)
    : {};
  const responseFields =
    resolveSchema(document, successSchema).properties ?? {};
  const paging = options.paged
    ? [
        {
          parameter: "offset",
          field: "nextOffset",
          initial: "0",
          type: "number",
        },
        {
          parameter: "cursor",
          field: "nextCursor",
          initial: "undefined",
          type: "string | undefined",
        },
      ].find(
        ({ parameter, field }) =>
          responseFields[field] &&
          found.operation.parameters?.some(
            (p) => p.in === "query" && p.name === parameter,
          ),
      )
    : undefined;
  if (options.paged && !paging)
    throw new Error(
      "--paged requires offset/nextOffset or cursor/nextCursor in OpenAPI",
    );
  const problemStatuses = Object.keys(found.operation.responses ?? {})
    .filter((status) => /^[45]\d\d$/.test(status))
    .map(Number);
  const tokenOperation = JSON.stringify(found.operation).includes('"token"');
  const requestFixture = { param: {}, query: {} };
  for (const name of pathParams) requestFixture.param[name] = sampleValue(name);
  for (const parameter of found.operation.parameters ?? []) {
    if (parameter.in === "query" && parameter.required)
      requestFixture.query[parameter.name] = sampleValue(
        parameter.name,
        parameter.schema,
      );
  }
  if (!Object.keys(requestFixture.query).length) delete requestFixture.query;
  const bodySchema =
    found.operation.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) requestFixture.json = defaultForSchema(document, bodySchema);
  const emptyRequestFixture = structuredClone(requestFixture);
  emptyRequestFixture.param[pathParams[0]] = "";
  const expectedPath = `/api${found.path.replace(/\{([^}]+)\}/g, (_match, name) => encodeURIComponent(requestFixture.param[name]))}`;
  const base = `${root}/apps/web/src/quills/api/${area}/${names.file}`;
  const hookBase = `${root}/apps/web/src/quills/hooks/${area}/use-${names.file}`;
  await assertNewPaths(root, [
    `${base}.ts`,
    `${base}.fixture.ts`,
    `${base}.test.ts`,
    `${hookBase}.ts`,
    `${hookBase}.test.tsx`,
  ]);
  const queryOptionsSource =
    kind === "query"
      ? await renderTemplate(root, "operation/query-options.ts.txt.tpl", {
          NAME: names.name,
          PASCAL: names.pascal,
        })
      : "";
  const infiniteQueryOptionsSource = paging
    ? await renderTemplate(
        root,
        "operation/infinite-query-options.ts.txt.tpl",
        {
          NAME: names.name,
          PASCAL: names.pascal,
          PAGE_TYPE: paging.type,
          INITIAL_PAGE: paging.initial,
          PAGE_PARAMETER: paging.parameter,
          PAGE_VALUE:
            paging.parameter === "offset" ? "String(pageParam)" : "pageParam",
          NEXT_FIELD: paging.field,
        },
      )
    : "";
  const operation = await renderTemplate(root, "operation/operation.ts.tpl", {
    QUERY_IMPORT:
      kind === "query"
        ? paging
          ? 'import { infiniteQueryOptions, queryOptions, type InfiniteData } from "@tanstack/react-query";\n'
          : 'import { queryOptions } from "@tanstack/react-query";\n'
        : "",
    PROBLEM_TYPE: kind === "query" ? "PortalProblem, " : "",
    ENDPOINT: endpoint,
    PASCAL: names.pascal,
    STATUS: successStatus,
    NAME: names.name,
    WORKSPACE_PARAM: workspaceParam,
    AREA: JSON.stringify(area),
    NAME_JSON: JSON.stringify(names.name),
    TOKEN_OPERATION: tokenOperation,
    QUERY_OPTIONS: `${queryOptionsSource}${infiniteQueryOptionsSource}`,
  });
  const fixture = await renderTemplate(root, "operation/fixture.ts.tpl", {
    PASCAL: names.pascal,
    FILE: names.file,
    NAME: names.name,
    BODY: JSON.stringify(fixtureBody),
    STATUSES: problemStatuses.length ? problemStatuses.join(" | ") : "never",
  });
  let hook;
  const invalidated =
    options.invalidates?.split(",").filter(Boolean).map(operationNames) ?? [];
  const optimisticTarget = options.optimistic
    ? operationNames(options.optimistic)
    : null;
  if (kind === "query" && options.paged)
    hook = await renderTemplate(root, "operation/paged-hook.ts.tpl", {
      NAME: names.name,
      PASCAL: names.pascal,
      AREA_RAW: area,
      FILE: names.file,
      REQUIRED: required.join(" && "),
    });
  else if (kind === "query")
    hook = await renderTemplate(root, "operation/query-hook.ts.tpl", {
      NAME: names.name,
      PASCAL: names.pascal,
      AREA_RAW: area,
      FILE: names.file,
      REQUIRED: required.join(" && "),
      POLL: options.poll
        ? `, refetchInterval: ${Number(options.poll) * 1000}, refetchIntervalInBackground: false`
        : "",
    });
  else
    hook = await renderTemplate(root, "operation/mutation-hook.ts.tpl", {
      NAME: names.name,
      PASCAL: names.pascal,
      AREA_RAW: area,
      FILE: names.file,
      VIEWER_TYPE: invalidated.length ? ", Viewer" : "",
      KEY_IMPORT: invalidated.length
        ? 'import { quillsOperationKey } from "../../api/keys";\n'
        : "",
      VIEWER_ARGUMENT: invalidated.length ? "viewer: Viewer" : "",
      CONTEXT_TYPE: options.optimistic
        ? ", { queryKey: readonly unknown[]; previous: unknown }"
        : "",
      OPTIMISTIC: options.optimistic
        ? `onMutate: async (input) => { const queryKey = quillsOperationKey(input.param.${workspaceParam}, viewer, ${JSON.stringify(area)}, ${JSON.stringify(optimisticTarget.name)}); await queryClient.cancelQueries({ queryKey }); const previous = queryClient.getQueryData(queryKey); queryClient.setQueryData(queryKey, input.json); return { queryKey, previous }; }, onError: (_error, _input, context) => { if (context) queryClient.setQueryData(context.queryKey, context.previous); }, `
        : "",
      INVALIDATIONS: invalidated.length
        ? invalidated
            .map(
              (target) =>
                `await queryClient.invalidateQueries({ queryKey: quillsOperationKey(input.param.${workspaceParam}, viewer, ${JSON.stringify(area)}, ${JSON.stringify(target.name)}) });`,
            )
            .join(" ")
        : marker,
    });
  const operationTest = await renderTemplate(
    root,
    "operation/operation.test.ts.tpl",
    {
      NAME: names.name,
      FILE: names.file,
      NAME_JSON: JSON.stringify(names.name),
      OPERATION_ID: JSON.stringify(operationId),
      REQUEST: JSON.stringify(requestFixture),
      METHOD: JSON.stringify(found.method),
      PATH: JSON.stringify(expectedPath),
      STATUSES: JSON.stringify(problemStatuses),
    },
  );
  const hookTest = await renderTemplate(root, "operation/hook.test.tsx.tpl", {
    KEY_IMPORT: invalidated.length
      ? 'import { quillsOperationKey } from "../../api/keys";\n'
      : "",
    NAME: names.name,
    PASCAL: names.pascal,
    AREA_RAW: area,
    FILE: names.file,
    HOOK_NAME: JSON.stringify(`use${names.pascal}`),
    KIND: JSON.stringify(kind),
    OPERATION_ID: JSON.stringify(operationId),
    REQUEST: JSON.stringify(requestFixture),
    EMPTY_REQUEST:
      kind === "query"
        ? `emptyRequest: ${JSON.stringify(emptyRequestFixture)}, `
        : "",
    TAKES_VIEWER: invalidated.length > 0,
    INVALIDATIONS: invalidated
      .map(
        (target) =>
          `quillsOperationKey(${JSON.stringify(requestFixture.param[workspaceParam])}, { kind: "anonymous" }, ${JSON.stringify(area)}, ${JSON.stringify(target.name)})`,
      )
      .join(", "),
    PAGED: paging
      ? `paged: { cursor: ${paging.parameter === "offset" ? "20" : '"cursor_test_2"'} },`
      : "",
    POLL_MS: options.poll ? `pollMs: ${Number(options.poll) * 1000},` : "",
    OPTIMISTIC_TEST: optimisticTarget
      ? `optimistic: { queryKey: quillsOperationKey(${JSON.stringify(requestFixture.param[workspaceParam])}, { kind: "anonymous" }, ${JSON.stringify(area)}, ${JSON.stringify(optimisticTarget.name)}), before: {}, after: ${JSON.stringify(requestFixture.json ?? {})} },`
      : "",
  });
  const output = await Promise.all([
    writeNew(root, `${base}.ts`, operation),
    writeNew(root, `${base}.fixture.ts`, fixture),
    writeNew(root, `${base}.test.ts`, operationTest),
    writeNew(root, `${hookBase}.ts`, hook),
    writeNew(root, `${hookBase}.test.tsx`, hookTest),
  ]);
  formatGenerated([
    `${base}.ts`,
    `${base}.fixture.ts`,
    `${base}.test.ts`,
    `${hookBase}.ts`,
    `${hookBase}.test.tsx`,
  ]);
  return output;
}

export async function generateType(root, input, options) {
  const [area, name] = input.includes("/")
    ? input.split("/")
    : [options.area, input];
  const selectedPath = options.at ?? options.path;
  if (!area || !options.from || !selectedPath)
    throw new Error(
      "type requires <area>/<Name> --from <operationId> --at <response.path>",
    );
  const source = operationNames(options.from);
  const access = selectedPath
    .split(".")
    .map((part) =>
      part.endsWith("[]")
        ? `[${JSON.stringify(part.slice(0, -2))}][number]`
        : `[${JSON.stringify(part)}]`,
    )
    .join("");
  const file = `${root}/apps/web/src/quills/api/${kebab(area)}/${kebab(name)}.type.ts`;
  await assertNewPaths(root, [file]);
  const output = [
    await writeNew(
      root,
      file,
      await renderTemplate(root, "type/type.ts.tpl", {
        SOURCE_TYPE: `${source.pascal}Response`,
        SOURCE_FILE: source.file,
        TYPE_NAME: pascal(name),
        ACCESS: access,
      }),
    ),
  ];
  formatGenerated([file]);
  return output;
}

function routeFile(route, parent = false) {
  const file = route.replace(/^\//, "").replace(/\/$/, "");
  return parent ? `${file}/index` : file;
}

async function operationArea(root, file) {
  const directory = join(root, "apps/web/src/quills/api");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await access(join(directory, entry.name, `${file}.ts`));
      return entry.name;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Generate the operation hook before the page: ${file}`);
}

export async function generatePage(root, name, options) {
  for (const required of ["route", "audience", "feature"])
    if (!options[required]) throw new Error(`--${required} is required`);
  const id = kebab(name);
  if (!name || id !== name)
    throw new Error("Page name must be lowercase kebab-case");
  if (
    !options.route.startsWith("/portal/") &&
    !options.route.startsWith("/quills/")
  )
    throw new Error("Page route must stay under /portal or /quills");
  if (
    !["public", "portal", "signed-in", "teammate", "development"].includes(
      options.audience,
    )
  )
    throw new Error(`Unknown page audience: ${options.audience}`);
  if (options.token && !["none", "query", "fragment"].includes(options.token))
    throw new Error(`Unknown token mode: ${options.token}`);
  const featureFile = `${root}/apps/web/src/quills/i18n/en-US/${kebab(options.feature)}.json`;
  const featureTranslations = JSON.parse(await readFile(featureFile, "utf8"));
  if (!("title" in featureTranslations))
    throw new Error(
      `${kebab(options.feature)}.json must define title before page generation`,
    );
  const keys = Object.keys(featureTranslations);
  if (keys.join("\n") !== [...keys].sort().join("\n"))
    throw new Error(
      `${kebab(options.feature)}.json keys must be sorted before page generation`,
    );
  let portalPathPatterns = [];
  if (options.route.startsWith("/portal/"))
    ({ portalPathPatterns } = await import(
      pathToFileURL(join(root, "apps/api/src/quills/portal/paths.ts")).href
    ));
  if (options.mailLinked) {
    if (
      !portalPathPatterns.some(
        (item) =>
          !item.pending &&
          item.pattern.replace(/\/$/, "") === options.route.replace(/\/$/, ""),
      )
    )
      throw new Error(
        `--mail-linked route is not registered in portalPathPatterns: ${options.route}`,
      );
  }
  const parentRoute = portalPathPatterns.some(
    (item) =>
      !item.pending &&
      item.pattern.startsWith(`${options.route.replace(/\/$/, "")}/`),
  );
  const routeId = parentRoute
    ? `${options.route.replace(/\/$/, "")}/`
    : options.route;
  const component = pascal(name);
  const operations = options.operations?.split(",").filter(Boolean) ?? [];
  const document = await readOpenApi(root);
  const hasMutation = operations.some(
    (operationId) => findOperation(document, operationId).method !== "get",
  );
  const token = options.token ?? "none";
  const states = [
    "loading",
    ...(token === "none" ? [] : ["gone"]),
    "failed",
    "ready",
    ...(hasMutation ? ["done"] : []),
  ];
  const metaValue = {
    id,
    feature: options.feature,
    route: options.route,
    audience: options.audience,
    mailLinked: Boolean(options.mailLinked),
    token,
    operations,
    states,
  };
  const base = `${root}/apps/web/src/quills/pages/${id}`;
  const meta = await renderTemplate(root, "page/meta.ts.tpl", {
    META: JSON.stringify(metaValue, null, 2),
  });
  const page = await renderTemplate(root, "page/page.tsx.tpl", {
    TOKEN_IMPORT:
      token === "none"
        ? ""
        : 'import { useState } from "react";\nimport { takeStashedToken } from "../../core/token-stash";\n',
    META_IMPORT: token === "none" ? "" : 'import { meta } from "./meta";',
    COMPONENT: component,
    TOKEN_STATE:
      token === "none"
        ? ""
        : "const [token] = useState(() => takeStashedToken(tokenScope));",
    TOKEN_SCOPE_DECL:
      token === "none"
        ? ""
        : 'const tokenScope = [props.workspaceId, ...Object.entries(props.params).filter(([key]) => key !== "workspaceId").map(([, value]) => value), meta.id].join(":");',
    TOKEN_VOID: token === "none" ? "" : "void token;",
    OPERATIONS: operations.join(", ") || "this page",
    TITLE_KEY: JSON.stringify(`${options.feature}.title`),
    TOKEN_MODE: JSON.stringify(token),
    TOKEN_SCOPE: token === "none" ? "undefined" : "tokenScope",
    PERSIST_TOKEN: options.audience === "signed-in",
  });
  const test = await renderTemplate(root, "page/page.test.tsx.tpl", {
    COMPONENT: component,
    ID: id,
    CASES: states
      .map((state) => {
        const options =
          state === "loading"
            ? "{ accessLoading: true }"
            : [
                  "authRequired",
                  "conflict",
                  "failed",
                  "gone",
                  "noAccess",
                  "notFound",
                ].includes(state)
              ? `{ accessProblem: { kind: ${JSON.stringify(state)} } }`
              : state === "rateLimited"
                ? '{ accessProblem: { kind: "rateLimited", retryAt: Date.now() + 60_000 } }'
                : "{}";
        return `    ${JSON.stringify(state)}: { prepare: () => (${options}) },`;
      })
      .join("\n"),
  });
  const searchItems =
    options.search
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  for (const item of searchItems)
    if (!/^[a-z][A-Za-z0-9]*:(string|number|boolean)$/.test(item))
      throw new Error(`Invalid --search field: ${item}`);
  const fields = searchItems
    .map((item) => {
      const [key, type] = item.split(":");
      return `${key}: z.${type === "number" ? "coerce.number" : type}().optional()`;
    })
    .join(", ");
  const prefetches = [];
  const prefetchImports = [];
  if (token === "none") {
    for (const operationId of operations) {
      const found = findOperation(document, operationId);
      if (found.method !== "get") continue;
      const operationName = operationNames(operationId);
      const area = await operationArea(root, operationName.file);
      const successSchema =
        found.operation.responses?.[
          Object.keys(found.operation.responses ?? {}).find((status) =>
            /^2\d\d$/.test(status),
          )
        ]?.content?.["application/json"]?.schema;
      const responseFields =
        resolveSchema(document, successSchema).properties ?? {};
      const paged = Boolean(
        responseFields.nextOffset || responseFields.nextCursor,
      );
      const optionsName = `${operationName.name}${paged ? "Infinite" : ""}Query`;
      prefetchImports.push(
        `import { ${optionsName} } from "@/quills/api/${area}/${operationName.file}";`,
      );
      const parameters = found.operation.parameters ?? [];
      const pathValues = [...found.path.matchAll(/\{([^}]+)\}/g)].map(
        (match) => {
          const parameter = match[1];
          const routeParameter =
            parameter === "workspace" || parameter === "workspaceId"
              ? "workspaceId"
              : parameter;
          return `${JSON.stringify(parameter)}: params.${routeParameter}`;
        },
      );
      const queryValues = parameters
        .filter((parameter) => parameter.in === "query")
        .flatMap((parameter) => {
          if (searchItems.some((item) => item.startsWith(`${parameter.name}:`)))
            return [
              `${JSON.stringify(parameter.name)}: search.${parameter.name}`,
            ];
          if (parameter.required)
            return [
              `${JSON.stringify(parameter.name)}: ${JSON.stringify(sampleValue(parameter.name, parameter.schema))}`,
            ];
          return [];
        });
      const input = `{ param: { ${pathValues.join(", ")} }${queryValues.length ? `, query: { ${queryValues.join(", ")} }` : ""} }`;
      prefetches.push(
        `context.queryClient.${paged ? "prefetchInfiniteQuery" : "prefetchQuery"}(${optionsName}(${input}, context.quillsPortal.viewer))`,
      );
    }
  }
  const routeLoadsI18n = options.route.startsWith("/quills/");
  const tokenSetup = `const value = removeTokenFromAddress(${JSON.stringify(token)}); if (value) stashToken([params.workspaceId, ...Object.entries(params).filter(([key]) => key !== "workspaceId").map(([, item]) => item), ${JSON.stringify(id)}].join(":"), value, ${options.audience === "signed-in"});`;
  const tokenBeforeLoad =
    token !== "none"
      ? `beforeLoad: async ({ params }) => { ${routeLoadsI18n ? "await ensureQuillsI18n(); " : ""}${tokenSetup} }, `
      : routeLoadsI18n
        ? "beforeLoad: () => ensureQuillsI18n(), "
        : "";
  const audienceGate =
    options.audience === "public"
      ? "context.quillsPortal.portalAvailable"
      : options.audience === "portal"
        ? "context.quillsPortal.accessGranted"
        : options.audience === "signed-in" || options.audience === "teammate"
          ? 'context.quillsPortal.accessGranted && context.quillsPortal.viewer.kind === "user"'
          : "true";
  const beforeLoad = prefetches.length
    ? `beforeLoad: async ({ context, params, search }) => { void search; if (!(${audienceGate})) return; await Promise.all([${prefetches.join(", ")}]); }, `
    : tokenBeforeLoad;
  const route = await renderTemplate(root, "page/route.tsx.tpl", {
    COMPONENT: component,
    ID: id,
    I18N_IMPORT: routeLoadsI18n
      ? 'import { ensureQuillsI18n } from "@/quills/i18n/load";\n'
      : "",
    TOKEN_IMPORT:
      token === "none"
        ? ""
        : 'import { removeTokenFromAddress, stashToken } from "@/quills/core/token-stash";\n',
    PREFETCH_IMPORTS: prefetchImports.length
      ? `${prefetchImports.join("\n")}\n`
      : "",
    FIELDS: fields,
    ROUTE: JSON.stringify(routeId),
    BEFORE_LOAD: beforeLoad,
  });
  const routeTest = await renderTemplate(root, "page/route.test.tsx.tpl", {
    ROUTE_FILE: routeFile(options.route, parentRoute).split("/").at(-1),
  });
  const outputs = [
    `${base}/meta.ts`,
    `${base}/${id}-page.tsx`,
    `${base}/${id}-page.test.tsx`,
    `${root}/apps/web/src/routes/${routeFile(options.route, parentRoute)}.tsx`,
    `${root}/apps/web/src/routes/${routeFile(options.route, parentRoute)}.test.tsx`,
  ];
  await assertNewPaths(root, outputs);
  const output = await Promise.all([
    writeNew(root, `${base}/meta.ts`, meta),
    writeNew(root, `${base}/${id}-page.tsx`, page),
    writeNew(root, `${base}/${id}-page.test.tsx`, test),
    writeNew(
      root,
      `${root}/apps/web/src/routes/${routeFile(options.route, parentRoute)}.tsx`,
      route,
    ),
    writeNew(
      root,
      `${root}/apps/web/src/routes/${routeFile(options.route, parentRoute)}.test.tsx`,
      routeTest,
    ),
  ]);
  formatGenerated(outputs);
  return output;
}

export async function generateComponent(root, kind, input, options = {}) {
  const slash = input.lastIndexOf("/");
  const scope = slash < 0 ? "" : input.slice(0, slash);
  const rawName = slash < 0 ? input : input.slice(slash + 1);
  const baseName = kebab(rawName);
  const isForm = kind === "form";
  const name =
    isForm && !pascal(rawName).endsWith("Form")
      ? `${pascal(rawName)}Form`
      : pascal(rawName);
  let base;
  if (kind === "component")
    base = `${root}/apps/web/src/quills/ui/${scope ? `${kebab(scope)}/` : ""}${baseName}`;
  else {
    if (!scope) throw new Error(`${kind} requires <page>/<Name>`);
    base = `${root}/apps/web/src/quills/pages/${kebab(scope)}/parts/${baseName}${isForm && !baseName.endsWith("-form") ? "-form" : ""}`;
  }
  let formSchema = "z.object({})";
  let formDefaults = {};
  let formField = "field";
  let formValidValue = "value";
  if (isForm) {
    if (!options.operation)
      throw new Error("form requires --operation <operationId>");
    const document = await readOpenApi(root);
    const found = findOperation(document, options.operation);
    const requestSchema =
      found.operation.requestBody?.content?.["application/json"]?.schema;
    if (!requestSchema)
      throw new Error(`${options.operation} has no JSON request body schema`);
    formSchema = zodForSchema(document, requestSchema);
    formDefaults = defaultForSchema(document, requestSchema);
    const properties = resolveSchema(document, requestSchema).properties ?? {};
    formField = Object.keys(properties)[0] ?? "field";
    formValidValue = sampleValue(formField, properties[formField]);
  }
  const source = isForm
    ? await renderTemplate(root, "component/form.tsx.tpl", {
        SCHEMA: formSchema,
        NAME: name,
        DEFAULTS: JSON.stringify(formDefaults),
        SUBMIT_KEY: `${kebab(scope)}.submit`,
        FIELD_ID: `${kebab(scope)}-${kebab(formField)}`,
        FIELD_NAME: JSON.stringify(formField),
        FIELD_RAW: formField,
        FIELD_LABEL_KEY: JSON.stringify(`${kebab(scope)}.${formField}`),
      })
    : await renderTemplate(root, "component/component.tsx.tpl", {
        NAME: name,
        KEY: JSON.stringify(`${kebab(scope || "core")}.${baseName}`),
      });
  const depth =
    kind === "component"
      ? scope
        ? "../../test/render"
        : "../test/render"
      : "../../../test/render";
  const test = isForm
    ? await renderTemplate(root, "component/form.test.tsx.tpl", {
        NAME: name,
        FILE: base.split("/").at(-1),
        NAME_JSON: JSON.stringify(name),
        FIELD_NAME: JSON.stringify(`TODO ${formField}`),
        ISSUE_PATH: JSON.stringify(formField),
        SUBMIT_NAME: JSON.stringify(`TODO ${kebab(scope)} submit`),
        VALID_VALUE: JSON.stringify(formValidValue),
        EXPECTED_VALUES: JSON.stringify({
          ...formDefaults,
          [formField]: formValidValue,
        }),
      })
    : await renderTemplate(root, "component/component.test.tsx.tpl", {
        RENDER_PATH: JSON.stringify(depth),
        NAME: name,
        FILE: base.split("/").at(-1),
        NAME_JSON: JSON.stringify(name),
      });
  const translationFeature = kebab(scope || "core");
  const translation = `${root}/apps/web/src/quills/i18n/en-US/${translationFeature}.json`;
  JSON.parse(await readFile(translation, "utf8"));
  await assertNewPaths(root, [`${base}.tsx`, `${base}.test.tsx`]);
  const outputs = await Promise.all([
    writeNew(root, `${base}.tsx`, source),
    writeNew(root, `${base}.test.tsx`, test),
  ]);
  outputs.push(
    await addSortedJsonKeys(
      root,
      translation,
      isForm
        ? {
            [formField]: `TODO ${formField}`,
            submit: `TODO ${kebab(scope)} submit`,
          }
        : { [baseName]: `TODO ${baseName}` },
    ),
  );
  formatGenerated([`${base}.tsx`, `${base}.test.tsx`, translation]);
  return outputs;
}

export async function generateRedirect(root, from, to) {
  if (!from?.startsWith("/") || !to?.startsWith("/"))
    throw new Error("Redirect paths must start with /");
  const base = `${root}/apps/web/src/routes/${routeFile(from)}`;
  const source = await renderTemplate(root, "redirect/route.tsx.tpl", {
    FROM: JSON.stringify(from),
    TO: JSON.stringify(to),
  });
  const test = await renderTemplate(root, "redirect/route.test.tsx.tpl", {
    ROUTE_FILE: routeFile(from).split("/").at(-1),
    PARAMS: JSON.stringify(
      Object.fromEntries(
        [...from.matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)].map(([, name]) => [
          name,
          sampleValue(name),
        ]),
      ),
    ),
    TO: JSON.stringify(to),
  });
  await assertNewPaths(root, [`${base}.tsx`, `${base}.test.tsx`]);
  const output = await Promise.all([
    writeNew(root, `${base}.tsx`, source),
    writeNew(root, `${base}.test.tsx`, test),
  ]);
  formatGenerated([`${base}.tsx`, `${base}.test.tsx`]);
  return output;
}

export async function generateMissingTest(root, input) {
  const source = resolve(root, input);
  const name = relative(root, source).replaceAll("\\", "/");
  if (
    !name.startsWith("apps/web/src/quills/") &&
    !name.startsWith("apps/web/src/routes/portal/") &&
    !name.startsWith("apps/web/src/routes/quills/")
  )
    throw new Error("test source must be in a fork-owned Quills web path");
  const text = await readFile(source, "utf8");
  const tsx = source.endsWith(".tsx");
  const testPath = source.replace(/\.(ts|tsx)$/, `.test.${tsx ? "tsx" : "ts"}`);
  await assertNewPaths(root, [testPath]);
  const local = `./${source
    .split("/")
    .at(-1)
    .replace(/\.(ts|tsx)$/, "")}`;
  let output;
  if (
    name.includes("/api/") &&
    !name.endsWith(".fixture.ts") &&
    !name.endsWith(".type.ts")
  ) {
    const fn = text.match(/export async function (\w+)/)?.[1];
    if (!fn) throw new Error("Could not find the operation export");
    const document = await readOpenApi(root);
    let operationId;
    for (const methods of Object.values(document.paths ?? {}))
      for (const operation of Object.values(methods))
        if (operationNames(operation.operationId ?? "X").name === fn)
          operationId = operation.operationId;
    if (!operationId) throw new Error(`No OpenAPI operation matches ${fn}`);
    const found = findOperation(document, operationId);
    const request = { param: {}, query: {} };
    for (const parameter of [...found.path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    ))
      request.param[parameter] = sampleValue(parameter);
    for (const parameter of found.operation.parameters ?? [])
      if (parameter.in === "query" && parameter.required)
        request.query[parameter.name] = sampleValue(
          parameter.name,
          parameter.schema,
        );
    if (!Object.keys(request.query).length) delete request.query;
    const bodySchema =
      found.operation.requestBody?.content?.["application/json"]?.schema;
    if (bodySchema) request.json = defaultForSchema(document, bodySchema);
    const status = Number(
      Object.keys(found.operation.responses ?? {}).find((value) =>
        /^2\d\d$/.test(value),
      ) ?? 200,
    );
    const responseSchema =
      found.operation.responses?.[status]?.content?.["application/json"]
        ?.schema;
    output = await renderTemplate(root, "test/operation.test.ts.tpl", {
      NAME: fn,
      LOCAL: JSON.stringify(local),
      NAME_JSON: JSON.stringify(fn),
      OPERATION_ID: JSON.stringify(operationId),
      REQUEST: JSON.stringify(request),
      RESPONSE: JSON.stringify(
        responseSchema ? defaultForSchema(document, responseSchema) : {},
      ),
      METHOD: JSON.stringify(found.method),
      PATH: JSON.stringify(
        `/api${found.path.replace(/\{([^}]+)\}/g, (_match, parameter) => encodeURIComponent(request.param[parameter]))}`,
      ),
      STATUSES: JSON.stringify(
        Object.keys(found.operation.responses ?? {})
          .filter((value) => /^[45]\d\d$/.test(value))
          .map(Number),
      ),
    });
  } else if (name.includes("/hooks/")) {
    const hook = text.match(/export function (use\w+)/)?.[1];
    if (!hook) throw new Error("Could not find the hook export");
    const document = await readOpenApi(root);
    const operationId = Object.values(document.paths ?? {})
      .flatMap((methods) => Object.values(methods))
      .map((operation) => operation.operationId)
      .find((id) => id && `use${operationNames(id).pascal}` === hook);
    if (!operationId) throw new Error(`No OpenAPI operation matches ${hook}`);
    output = await renderTemplate(root, "test/hook.test.tsx.tpl", {
      NAME: hook,
      LOCAL: JSON.stringify(local),
      NAME_JSON: JSON.stringify(hook),
      KIND: text.includes("useMutation") ? '"mutation"' : '"query"',
      OPERATION_ID: JSON.stringify(operationId),
      REQUEST: JSON.stringify({ param: { workspace: "workspace_test_1" } }),
    });
  } else if (source.endsWith("-page.tsx")) {
    const component = text.match(/export function (\w+Page)/)?.[1];
    const metaSource = await readFile(join(dirname(source), "meta.ts"), "utf8");
    const metaValue = JSON.parse(
      metaSource.match(
        /export const meta = (\{[\s\S]*\}) satisfies PageMeta/,
      )?.[1] ?? "{}",
    );
    output = await renderTemplate(root, "test/page.test.tsx.tpl", {
      NAME: component,
      LOCAL: JSON.stringify(local),
      NAME_JSON: JSON.stringify(component),
      CASES: (metaValue.states ?? [])
        .map((state) => {
          const options =
            state === "loading"
              ? "{ accessLoading: true }"
              : [
                    "authRequired",
                    "conflict",
                    "failed",
                    "gone",
                    "noAccess",
                    "notFound",
                  ].includes(state)
                ? `{ accessProblem: { kind: ${JSON.stringify(state)} } }`
                : state === "rateLimited"
                  ? '{ accessProblem: { kind: "rateLimited", retryAt: Date.now() + 60_000 } }'
                  : "{}";
          return `    ${JSON.stringify(state)}: { prepare: () => (${options}) },`;
        })
        .join("\n"),
    });
  } else {
    const component = text.match(/export function (\w+)/)?.[1];
    if (!component) throw new Error("Could not determine the source kind");
    const depth = name.includes("/pages/")
      ? "../../../test/render"
      : name.split("/ui/")[1].includes("/")
        ? "../../test/render"
        : "../test/render";
    output = await renderTemplate(root, "test/component.test.tsx.tpl", {
      RENDER_PATH: JSON.stringify(depth),
      NAME: component,
      LOCAL: JSON.stringify(local),
      NAME_JSON: JSON.stringify(component),
    });
  }
  const result = [await writeNew(root, testPath, output)];
  formatGenerated([testPath]);
  return result;
}
