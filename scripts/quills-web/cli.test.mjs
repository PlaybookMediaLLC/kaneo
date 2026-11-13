import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { transform } from "esbuild";
import { fileURLToPath } from "node:url";
import {
  generateComponent,
  generateFeature,
  generateMissingTest,
  generateOperation,
  generatePage,
  generateRedirect,
  generateType,
} from "./lib/generate.mjs";
import { operationNames } from "./lib/naming.mjs";
import { runMigrations } from "./lib/migrate.mjs";

const sourceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function fixtureRoot() {
  const root = await mkdtemp(`${tmpdir()}/quills-web-`);
  await mkdir(`${root}/apps/docs`, { recursive: true });
  await cp(
    `${sourceRoot}/apps/docs/openapi.json`,
    `${root}/apps/docs/openapi.json`,
  );
  await mkdir(`${root}/apps/api/src/quills/portal`, { recursive: true });
  await cp(
    `${sourceRoot}/apps/api/src/quills/portal/paths.ts`,
    `${root}/apps/api/src/quills/portal/paths.ts`,
  );
  await mkdir(`${root}/apps/web/src/quills/i18n/en-US`, { recursive: true });
  await cp(
    `${sourceRoot}/apps/web/src/quills/i18n/en-US/core.json`,
    `${root}/apps/web/src/quills/i18n/en-US/core.json`,
  );
  return root;
}

async function generatedSources(path) {
  const output = [];
  for (const name of await readdir(path)) {
    const child = `${path}/${name}`;
    if ((await stat(child)).isDirectory())
      output.push(...(await generatedSources(child)));
    else if (/\.(ts|tsx)$/.test(name)) output.push(child);
  }
  return output;
}

async function generatedFiles(root, path) {
  const output = [];
  for (const name of await readdir(path)) {
    const child = `${path}/${name}`;
    if ((await stat(child)).isDirectory())
      output.push(...(await generatedFiles(root, child)));
    else output.push(child.slice(root.length + 1));
  }
  return output;
}

test("operation naming removes Quills once", () => {
  assert.deepEqual(operationNames("previewQuillsUnsubscribeToken"), {
    name: "previewUnsubscribeToken",
    pascal: "PreviewUnsubscribeToken",
    file: "preview-unsubscribe-token",
  });
});

test("supports help, JSON dry runs and usage exit codes", () => {
  const cli = `${sourceRoot}/scripts/quills-web/cli.mjs`;
  const help = spawnSync(process.execPath, [cli, "help", "query"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:.*query/);
  const dryRun = spawnSync(
    process.execPath,
    [cli, "feature", "cli-dry-run-proof", "--dry-run", "--json"],
    { cwd: sourceRoot, encoding: "utf8" },
  );
  assert.equal(dryRun.status, 0);
  assert.deepEqual(JSON.parse(dryRun.stdout), {
    files: ["apps/web/src/quills/i18n/en-US/cli-dry-run-proof.json"],
    dryRun: true,
    next: "node scripts/quills-web/cli.mjs check",
  });
  const usage = spawnSync(
    process.execPath,
    [cli, "query", "operation", "--unknown"],
    { cwd: sourceRoot, encoding: "utf8" },
  );
  assert.equal(usage.status, 2);
});

test("runs framework migrations idempotently", async () => {
  const root = await fixtureRoot();
  const directory = `${root}/apps/web/src/quills/api/notifications`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/preview-unsubscribe-token.test.ts`,
    `import { describe } from "vite-plus/test";\nimport { describeOperationContract } from "../../test/contracts";\nimport { previewUnsubscribeToken } from "./preview-unsubscribe-token";\ndescribe("previewUnsubscribeToken", () => { describeOperationContract({ operationId: "previewQuillsUnsubscribeToken", operation: previewUnsubscribeToken }); });\n`,
  );
  assert.equal((await runMigrations(root)).length, 1);
  assert.equal((await runMigrations(root)).length, 0);
});

test("generates each framework kind without overwriting", async () => {
  const root = await fixtureRoot();
  await generateFeature(root, "sample");
  assert.equal(
    await readFile(
      `${root}/apps/web/src/quills/i18n/en-US/sample.json`,
      "utf8",
    ),
    await readFile(
      `${sourceRoot}/scripts/quills-web/test/golden/feature.json`,
      "utf8",
    ),
  );
  await generateOperation(root, "query", "getQuillsPublicPortalConfig", {
    area: "portal",
  });
  await generateOperation(root, "mutation", "recordQuillsPortalAccessDenied", {
    area: "portal",
    invalidates: "getQuillsPublicPortalConfig",
  });
  await generateType(root, "portal/PortalConfig", {
    from: "getQuillsPublicPortalConfig",
    path: "features",
  });
  await generatePage(root, "sample", {
    route: "/portal/$workspaceId/sample",
    audience: "public",
    feature: "sample",
    token: "none",
    operations: "getQuillsPublicPortalConfig",
  });
  await generateComponent(root, "component", "SampleCard");
  await generateComponent(root, "part", "sample/SampleDetail");
  await generateComponent(root, "form", "sample/Sample", {
    operation: "createQuillsPortalPost",
  });
  await generateRedirect(
    root,
    "/portal/$workspaceId/old",
    "/portal/$workspaceId/sample",
  );
  await writeFile(
    `${root}/apps/web/src/quills/ui/extra.tsx`,
    "export interface ExtraProps {}\nexport function Extra(_props: ExtraProps) {\n  return null;\n}\n",
  );
  await generateMissingTest(root, "apps/web/src/quills/ui/extra.tsx");
  assert.match(
    await readFile(`${root}/apps/web/src/quills/pages/sample/meta.ts`, "utf8"),
    /satisfies PageMeta/,
  );
  const mutation = await readFile(
    `${root}/apps/web/src/quills/api/portal/record-portal-access-denied.ts`,
    "utf8",
  );
  assert.doesNotMatch(mutation, /queryOptions/);
  const mutationHook = await readFile(
    `${root}/apps/web/src/quills/hooks/portal/use-record-portal-access-denied.ts`,
    "utf8",
  );
  assert.match(mutationHook, /type RecordPortalAccessDeniedResponse/);
  assert.match(
    mutationHook,
    /useMutation<\s*RecordPortalAccessDeniedResponse,\s*PortalProblem,\s*RecordPortalAccessDeniedRequest\s*>/,
  );
  assert.match(
    mutationHook,
    /quillsOperationKey\(\s*input\.param\.workspace,\s*viewer,\s*"portal",\s*"getPublicPortalConfig",?\s*\)/,
  );
  assert.doesNotMatch(mutationHook, /as unknown as/);
  const query = await readFile(
    `${root}/apps/web/src/quills/api/portal/get-public-portal-config.ts`,
    "utf8",
  );
  assert.match(
    query,
    /queryOptions<\s*GetPublicPortalConfigResponse,\s*PortalProblem\s*>/,
  );
  for (const file of await generatedSources(`${root}/apps/web/src`)) {
    await transform(await readFile(file, "utf8"), {
      loader: file.endsWith(".tsx") ? "tsx" : "ts",
    });
  }
  const expectedFiles = JSON.parse(
    await readFile(
      `${sourceRoot}/scripts/quills-web/test/golden/generated-files.json`,
      "utf8",
    ),
  );
  assert.deepEqual(
    (await generatedFiles(root, `${root}/apps/web/src`)).sort(),
    expectedFiles,
  );
  for (const file of expectedFiles)
    assert.equal(
      await readFile(`${root}/${file}`, "utf8"),
      await readFile(
        `${sourceRoot}/scripts/quills-web/test/golden/generated/${file}`,
        "utf8",
      ),
      file,
    );
  const expectedContent = JSON.parse(
    await readFile(
      `${sourceRoot}/scripts/quills-web/test/golden/generated-content-sha256.json`,
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(expectedContent).sort(),
    expectedFiles.filter((file) => file !== "apps/web/src/quills/ui/extra.tsx"),
  );
  for (const [file, hash] of Object.entries(expectedContent))
    assert.equal(
      createHash("sha256")
        .update(await readFile(`${root}/${file}`))
        .digest("hex"),
      hash,
      file,
    );
  await assert.rejects(
    () => generateFeature(root, "sample"),
    /Refusing to overwrite/,
  );
});
