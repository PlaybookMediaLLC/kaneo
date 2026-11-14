import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readDocuments, inspectDocuments } from "./check.mjs";

const repository = resolve(import.meta.dirname, "../../../..");
let root, documents;
const fixtures = [
  ["C1", "routes/portal/broken.tsx", `export const Route = {};`],
  [
    "C2",
    "quills/core/missing-test.ts",
    `export const calculate = (x: number) => x + 1;`,
  ],
  [
    "C3",
    "quills/ui/literal.tsx",
    `export function Literal() { return <button aria-label="Run">Run</button>; }`,
  ],
  [
    "C4",
    "quills/ui/missing-key.tsx",
    `export function MissingKey() { return <p>{t("quills:unknown.title")}</p>; }`,
  ],
  [
    "C5",
    "quills/core/upstream-import.ts",
    `import { Button } from "@/components/ui/button"; export const value = Button;`,
  ],
  [
    "C6",
    "quills/pages/absent/meta.ts",
    `export const meta = {id:"absent", route:"/portal/$workspaceId/absent", mailLinked:true};`,
  ],
  [
    "C7",
    "quills/api/posts/raw.ts",
    `export async function raw() { return globalThis.fetch("/api"); }`,
  ],
  ["C8", "quills/api/posts/key.ts", `export const key = () => ["posts"];`],
  [
    "C9",
    "quills/pages/token/token-page.tsx",
    `export function TokenPage() { useEffect(() => mutation.mutate(), []); return <button onClick={() => mutation.mutate()}/>; }`,
  ],
  [
    "C10",
    "quills/ui/wrong-name.tsx",
    `export function DifferentName() { return <div/>; }`,
  ],
  [
    "C11",
    "quills/api/posts/unknown.ts",
    `export function unknownOperation() {}`,
  ],
  [
    "C12",
    "quills/core/unfinished.ts",
    `// TODO(quills-web): finish\nexport const unfinished = true;`,
  ],
  [
    "C13",
    "quills/ui/multiple.tsx",
    `export function First() { return <div/>; } export function Second() { return <div/>; }`,
  ],
  [
    "C14",
    "quills/pages/raw/raw-page.tsx",
    `export function RawPage() { return <main/>; }`,
  ],
  [
    "C15",
    "quills/ui/raw.test.tsx",
    `import {render} from "@testing-library/react"; render(<div/>);`,
  ],
  [
    "C16",
    "quills/api/posts/unsafe.fixture.ts",
    `export const fixture = {email: "person@invalid.test", createdAt: Date.now()};`,
  ],
  ["C17", "quills/core/default.ts", `export default function value() {}`],
  [
    "C18",
    "quills/ui/large.tsx",
    `export function Large() { return <div/>; }\n${"\n".repeat(201)}// end`,
  ],
  [
    "C19",
    "quills/ui/style.tsx",
    `export function Style() { return <div style={{color:"#ffffff"}}/>; }`,
  ],
  [
    "C20",
    "quills/pages/no-meta/no-meta-page.tsx",
    `export function NoMetaPage() { return <PageFrame/>; }`,
  ],
  [
    "C21",
    "quills/ui/link.tsx",
    `export function Link() { return <a href="/portal/workspace_test/posts/post_test"/>; }`,
  ],
  ["C22", "quills/ui/form.tsx", `export function Form() { return <form/>; }`],
  [
    "C23",
    "quills/ui/not-in-gallery.tsx",
    `export interface NotInGalleryProps {} export function NotInGallery() { return <div/>; }`,
  ],
];

async function write(file, text) {
  const path = join(root, file);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, text);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "quills-conformance-test-"));
  await write(
    "package.json",
    JSON.stringify({
      name: "quills-conformance-fixture",
      private: true,
      type: "module",
    }),
  );
  await write("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  await write(
    "apps/web/package.json",
    JSON.stringify({
      name: "quills-conformance-web",
      private: true,
      type: "module",
    }),
  );
  await symlink(
    join(repository, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
  await write(
    "scripts/quills-web/vite.config.mjs",
    await readFile(
      join(repository, "scripts/quills-web/vite.config.mjs"),
      "utf8",
    ),
  );
  await symlink(
    join(repository, "scripts/quills-web/lib"),
    join(root, "scripts/quills-web/lib"),
    "dir",
  );
  await write(
    "apps/docs/openapi.json",
    JSON.stringify({
      paths: {
        "/quills-public/{workspace}/items": {
          get: { operationId: "listQuillsItems" },
        },
      },
    }),
  );
  await write(
    "apps/api/src/quills/portal/paths.ts",
    `export const portalPathPatterns = [{id:"post",pattern:"/portal/$workspaceId/posts/$postId"}];`,
  );
  for (const [, file, source] of fixtures)
    await write(`apps/web/src/${file}`, source);
  await write(
    "apps/web/src/quills/pages/token/meta.ts",
    `export const meta = {id:"token", token:"query", states:["gone"], operations:[]};`,
  );
  await write(
    "apps/web/src/quills/i18n/en-US/core.json",
    JSON.stringify({ unused: "Unused" }),
  );
  await write(
    "apps/web/src/quills/i18n/en-US/plural.json",
    JSON.stringify({
      count_one: "{{count}} item",
      count_other: "{{count}} items",
    }),
  );
  await write(
    "apps/web/src/quills/ui/plural-count.tsx",
    'export function PluralCount() { return <p>{t("quills:plural.count", { count })}</p>; }',
  );
  await write(
    "apps/web/src/quills/core/comment.ts",
    `// export default and fetch() are harmless in a comment.\nexport type Safe = string;`,
  );
  await write(
    "apps/web/src/routes/portal/good.tsx",
    `import { GoodPage } from "@/quills/pages/good/good-page"; export const Route = createFileRoute("/portal/$workspaceId/good")({component:GoodPage});`,
  );
  await write(
    "apps/web/src/routes/portal/legacy.tsx",
    'export const Route = createFileRoute("/portal/$workspaceId/legacy")({beforeLoad: () => { throw redirect({to: "/portal/$workspaceId/status"}); }});',
  );
  await write(
    "apps/web/src/quills/api/client.ts",
    `export {client} from "@kaneo/libs";`,
  );
  await write(
    "apps/web/src/quills/conformance.test.ts",
    `import { checkConformance } from "../../../../scripts/quills-web/lib/rules/check.mjs";`,
  );
  await write(
    "apps/web/src/quills/ui/translated.tsx",
    `export interface TranslatedProps {}
export function Translated() { return <button aria-label={t("quills:core.action")}>{t("quills:core.action")}</button>; }`,
  );
  await write(
    "apps/web/src/quills/ui/dynamic-link.tsx",
    `export function DynamicLink() { return <a href={\`/portal/\${workspaceId}\`}/>; }`,
  );
  await write(
    "apps/web/src/quills/core/forged-exception.ts",
    "export const text = `\n// quills-web-allow C12: not a real comment\nTODO(quills-web)\n`;",
  );
  await write(
    "apps/web/src/quills/api/items/list-items.ts",
    "export function listItems() {}",
  );
  await write(
    "apps/web/src/quills/api/items/missing-viewer.ts",
    "export const key = () => quillsKey(workspace);",
  );
  await write(
    "apps/web/src/quills/ui/empty.test.tsx",
    'it("checks the export", () => { expect(Component).toBeDefined(); });',
  );
  await write(
    "apps/web/src/quills/pages/query/meta.ts",
    'export const meta = {id:"query",audience:"public",token:"none",operations:["listQuillsItems"],states:["ready"]};',
  );
  await write(
    "apps/web/src/quills/core/allowed-marker.ts",
    "// quills-web-allow C12: fixture documentation intentionally mentions the marker\n// TODO(quills-web)\nexport type Marker = string;",
  );
  await write(
    "apps/web/src/quills/core/dynamic-upstream.ts",
    'export const load = () => import("@/lib/auth-client");',
  );
  await write(
    "apps/web/src/quills/portal/prefetch.test.ts",
    'import { routeTree } from "../../routeTree.gen"; export const tree = routeTree;',
  );
  await write(
    "apps/web/src/quills/portal/not-prefetch.test.ts",
    'import { routeTree } from "../../routeTree.gen"; export const tree = routeTree;',
  );
  await write(
    "apps/web/src/quills/pages/token/selection.tsx",
    `export function Selection() { return <><button onClick={() => setRating(5)}/><ConfirmAction onConfirm={() => mutation.mutateAsync({rating})}/></>; }`,
  );
  await write(
    "apps/web/src/quills/ui/actions.test.tsx",
    'import { act, fireEvent, waitFor } from "@testing-library/react"; it("waits for behavior", async () => { await waitFor(() => expect(true).toBe(true)); });',
  );
  await write(
    "apps/web/src/quills/ui/allowed-multiline-style.tsx",
    `export function AllowedMultilineStyle() {
  // quills-web-allow C19: runtime branding variables must be scoped to the portal shell
  return (
    <main
      className="portal"
      style={{ color: theme.foreground }}
    />
  );
}`,
  );
  await write(
    "apps/web/src/quills/ui/stale-multiline-style.tsx",
    `export function StaleMultilineStyle() {
  // quills-web-allow C19: this exception belongs only to the following element
  const value = true;
  return <main style={{ color: theme.foreground }} data-value={value} />;
}`,
  );
  const team =
    "apps/web/src/routes/_layout/_authenticated/feedback/$workspaceId";
  await write(
    "apps/web/src/quills/pages/team-gated/meta.ts",
    'export const meta = {id:"team-gated",audience:"teammate",route:"/feedback/$workspaceId/gated",token:"none",operations:[],states:["ready"]};',
  );
  await write(
    "apps/web/src/quills/pages/team-gated/team-gated-page.tsx",
    `import { useTeamItems } from "../../hooks/team/use-team-items";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
export function TeamGatedPage() { const items = useTeamItems(); return <PageFrame><StateView><PortalGate/></StateView></PageFrame>; }`,
  );
  await write(
    "apps/web/src/quills/pages/team-ready/meta.ts",
    'export const meta = {id:"team-ready",audience:"teammate",route:"/feedback/$workspaceId/ready",token:"none",operations:[],states:["ready"]};',
  );
  await write(
    "apps/web/src/quills/pages/team-ready/team-ready-page.tsx",
    `import { useTeamItems } from "../../hooks/team/use-team-items";
import { TeamStateView } from "../../team/team-state-view";
export function TeamReadyPage() { const items = useTeamItems(); return <PageFrame><TeamStateView/></PageFrame>; }`,
  );
  await write(
    `${team}/ready/index.tsx`,
    'import { TeamReadyPage } from "@/quills/pages/team-ready/team-ready-page"; export const Route = createFileRoute("/_layout/_authenticated/feedback/$workspaceId/ready/")({component:TeamReadyPage});',
  );
  await write(
    `${team}/ready/index.test.tsx`,
    'import { Route } from "./index"; export const route = Route;',
  );
  documents = await readDocuments(root);
});
after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("conformance negative cases", () => {
  for (const [rule, file] of fixtures)
    it(`rejects the broken ${rule} contract using the actual parser`, async () => {
      const findings = await inspectDocuments(root, documents, rule);
      assert.ok(
        findings.some((f) => f.rule === rule && f.file.endsWith(file)),
        JSON.stringify(findings),
      );
    });
  it("does not mistake comment text for a default export", async () => {
    const findings = await inspectDocuments(root, documents, "C17");
    assert.ok(!findings.some((f) => f.file.endsWith("/comment.ts")));
  });
  it("rejects protected and reasonless exceptions", async () => {
    for (const code of [
      "// quills-web-allow C5: legacy import",
      "// quills-web-allow C18:",
    ]) {
      const findings = await inspectDocuments(
        root,
        [
          {
            file: "apps/web/src/quills/core/exception.ts",
            kind: "helper",
            code,
            nodes: [],
            ast: { body: [], comments: [{ type: "Line", start: 0 }] },
          },
        ],
        "C12",
      );
      assert.equal(findings.length, 1);
    }
  });
  it("limits an exception to the following line", async () => {
    const d = {
      file: "apps/web/src/quills/core/exception.ts",
      kind: "helper",
      code: "// quills-web-allow C12: a fixture explains the marker\n// TODO(quills-web)\n// TODO(quills-web)",
      nodes: [],
      ast: { body: [], comments: [{ type: "Line", start: 0 }] },
    };
    const findings = await inspectDocuments(root, [d], "C12");
    assert.deepEqual(
      findings.map((f) => f.line),
      [3],
    );
  });
  for (const [rule, suffix] of [
    ["C1", "routes/portal/good.tsx"],
    ["C2", "quills/api/client.ts"],
    ["C3", "quills/ui/translated.tsx"],
    ["C5", "quills/conformance.test.ts"],
    ["C15", "quills/ui/actions.test.tsx"],
    ["C13", "quills/ui/translated.tsx"],
    ["C17", "quills/api/client.ts"],
  ])
    it(`accepts the valid ${rule} framework shape`, async () => {
      const selected = documents.filter((d) => d.file.endsWith(suffix));
      assert.equal(selected.length, 1);
      assert.deepEqual(await inspectDocuments(root, selected, rule), []);
    });
  it("accepts i18next plural forms of a used key", async () => {
    const selected = documents.filter((d) =>
      /\/(plural\.json|plural-count\.tsx)$/.test(d.file),
    );
    assert.equal(selected.length, 2);
    assert.deepEqual(await inspectDocuments(root, selected, "C4"), []);
  });
  it("rejects portal path templates outside the link helper", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("/dynamic-link.tsx"),
    );
    assert.ok((await inspectDocuments(root, selected, "C21")).length > 0);
  });
  it("does not accept an exception hidden in a template string", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("/forged-exception.ts"),
    );
    const findings = await inspectDocuments(root, selected, "C12");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 3);
  });
  it("enforces the C10 subclause in quills/api/items/list-items.ts", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("quills/api/items/list-items.ts"),
    );
    assert.ok((await inspectDocuments(root, selected, "C10")).length > 0);
  });
  it("enforces the C8 subclause in quills/api/items/missing-viewer.ts", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("quills/api/items/missing-viewer.ts"),
    );
    assert.ok((await inspectDocuments(root, selected, "C8")).length > 0);
  });
  it("enforces the C15 subclause in quills/ui/empty.test.tsx", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("quills/ui/empty.test.tsx"),
    );
    assert.ok((await inspectDocuments(root, selected, "C15")).length > 0);
  });
  it("enforces the C20 subclause in quills/pages/query/meta.ts", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("quills/pages/query/meta.ts"),
    );
    assert.ok((await inspectDocuments(root, selected, "C20")).length > 0);
  });
  it("accepts a real parsed exception only for its next line", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("/allowed-marker.ts"),
    );
    assert.deepEqual(await inspectDocuments(root, selected, "C12"), []);
  });
  it("attaches a C19 exception to the next multiline JSX opening element", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("/allowed-multiline-style.tsx"),
    );
    assert.deepEqual(await inspectDocuments(root, selected, "C19"), []);
  });
  it("does not attach a C19 exception across another statement", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("/stale-multiline-style.tsx"),
    );
    assert.equal((await inspectDocuments(root, selected, "C19")).length, 1);
  });
  it("enforces the upstream boundary for dynamic imports", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("/dynamic-upstream.ts"),
    );
    assert.ok((await inspectDocuments(root, selected, "C5")).length > 0);
  });
  it("allows only the named router integration test to import the generated route tree", async () => {
    const allowed = documents.filter((d) =>
      d.file.endsWith("/quills/portal/prefetch.test.ts"),
    );
    const rejected = documents.filter((d) =>
      d.file.endsWith("/quills/portal/not-prefetch.test.ts"),
    );
    assert.deepEqual(await inspectDocuments(root, allowed, "C5"), []);
    assert.equal((await inspectDocuments(root, rejected, "C5")).length, 1);
  });
  it("keeps teammate pages off the portal gate and on the teammate access state", async () => {
    const gated = documents.filter((d) => d.file.includes("/team-gated/"));
    const findings = await inspectDocuments(root, gated, "C14");
    assert.equal(findings.length, 2, JSON.stringify(findings));
    assert.match(findings[0].message + findings[1].message, /TeamStateView/);
    const ready = documents.filter((d) => d.file.includes("/team-ready/"));
    assert.deepEqual(await inspectDocuments(root, ready, "C14"), []);
  });
  it("matches a teammate page with its route in the teammate app folder", async () => {
    const selected = documents.filter(
      (d) =>
        d.file.includes("/team-ready/") ||
        d.file.includes("/feedback/$workspaceId/ready/index"),
    );
    assert.equal(selected.length, 4);
    for (const rule of ["C1", "C5", "C6"])
      assert.deepEqual(
        (await inspectDocuments(root, selected, rule)).filter(
          (f) => f.file !== "apps/api/src/quills/portal/paths.ts",
        ),
        [],
        rule,
      );
  });
  it("accepts a generated redirect destination as a route declaration", async () => {
    const selected = documents.filter((d) =>
      d.file.endsWith("routes/portal/legacy.tsx"),
    );
    assert.deepEqual(await inspectDocuments(root, selected, "C21"), []);
  });
});

it("permits local token-page selection but gates mutations", async () => {
  const selected = documents.filter(
    (d) =>
      d.file.endsWith("pages/token/meta.ts") ||
      d.file.endsWith("pages/token/selection.tsx"),
  );
  assert.deepEqual(await inspectDocuments(root, selected, "C9"), []);
});
