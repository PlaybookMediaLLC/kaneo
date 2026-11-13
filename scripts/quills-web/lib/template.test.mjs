import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { renderTemplate } from "./template.mjs";

test("renders every declared value and rejects a missing value", async () => {
  const root = await mkdtemp(`${tmpdir()}/quills-template-`);
  await mkdir(`${root}/scripts/quills-web/templates`, { recursive: true });
  await writeFile(
    `${root}/scripts/quills-web/templates/example.txt.tpl`,
    "{{VALUE}} {{MISSING}}",
  );
  await assert.rejects(
    () => renderTemplate(root, "example.txt.tpl", { VALUE: "ok" }),
    /MISSING/,
  );
  assert.equal(
    await renderTemplate(root, "example.txt.tpl", {
      VALUE: "ok",
      MISSING: "done",
    }),
    "ok done",
  );
});

test("keeps every generated source body in a declared plaintext template", async () => {
  const templateRoot = `${import.meta.dirname}/../templates`;
  async function files(directory, prefix = "") {
    const output = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        output.push(...(await files(`${directory}/${entry.name}`, name)));
      else output.push(name);
    }
    return output;
  }
  const source = await readFile(`${import.meta.dirname}/generate.mjs`, "utf8");
  const referenced = [
    ...source.matchAll(/renderTemplate\(\s*root,\s*"([^"]+)"/g),
  ]
    .map((match) => match[1])
    .sort();
  assert.deepEqual((await files(templateRoot)).sort(), referenced);
  assert.doesNotMatch(
    source,
    /(?:operation|fixture|hook|operationTest|hookTest|page|route|source|test|output)\s*=\s*`/,
  );
});
