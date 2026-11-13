import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./verify.mjs";
test("verify uses Corepack in a fresh checkout and reports the failed command", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-verify-test-"));
  const previous = process.env.PATH;
  try {
    await writeFile(
      join(root, "corepack"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > called-args\nexit 7\n',
      { mode: 0o755 },
    );
    process.env.PATH = root;
    assert.throws(() => run(root, [], {}), /web typecheck failed with exit 7/);
    assert.equal(
      await readFile(join(root, "called-args"), "utf8"),
      "pnpm\n--filter\n@kaneo/web\ntypecheck\n",
    );
  } finally {
    process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("verify discovers root and nested framework tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "quills-verify-discovery-"));
  const previous = process.env.PATH;
  const testContext = process.env.NODE_TEST_CONTEXT;
  try {
    for (const directory of [
      "node_modules/.bin",
      "scripts/quills-web/nested",
      "scripts/quills-port",
    ])
      await mkdir(join(root, directory), { recursive: true });
    for (const executable of ["corepack", "node_modules/.bin/vp"])
      await writeFile(join(root, executable), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
    for (const name of ["root", "nested/child"])
      await writeFile(
        join(root, `scripts/quills-web/${name}.test.mjs`),
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(root, name.replace("/", "-") + ".ran"))}, "passed");`,
      );
    await writeFile(join(root, "scripts/quills-web/cli.mjs"), "");
    await writeFile(join(root, "scripts/quills-port/check-upstream.mjs"), "");
    process.env.PATH = root;
    delete process.env.NODE_TEST_CONTEXT;
    run(root, [], {});
    for (const name of ["root", "nested-child"])
      assert.equal(await readFile(join(root, `${name}.ran`), "utf8"), "passed");
  } finally {
    process.env.PATH = previous;
    if (testContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = testContext;
    await rm(root, { recursive: true, force: true });
  }
});
