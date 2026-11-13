# Quills web framework

Run commands from the repository root with Node 24. Generated files stay under the fork-owned Quills web paths and are never overwritten.

Before the first web typecheck in a fresh worktree, install dependencies and build the web package dependencies:

```sh
pnpm install --frozen-lockfile
pnpm --filter '@kaneo/web^...' build
```

## Golden path

```sh
node scripts/quills-web/cli.mjs feature csat
node scripts/quills-web/cli.mjs query validateQuillsCsatEmailToken --area support
node scripts/quills-web/cli.mjs mutation recordQuillsCsatViaToken --area support --invalidates validateQuillsCsatEmailToken
node scripts/quills-web/cli.mjs page csat --route '/portal/$workspaceId/csat' --audience public --feature csat --token query --mail-linked --search token:string,rating:number --operations validateQuillsCsatEmailToken,recordQuillsCsatViaToken
node scripts/quills-web/cli.mjs part csat/RatingScale
```

Replace every `TODO(quills-web)` marker. Add behavior cases to the generated tests, then run `node scripts/quills-web/cli.mjs verify`.

### Complete unsubscribe reference

The token route removes `token` from the address bar in `beforeLoad` and stashes it before the page or a query can run. The generated page reads it once with `takeStashedToken(tokenScope)`. Do not read `search.token` or put the token in a redirect. A public page keeps the token in component state only; local storage is reserved for a signed-in page's authentication round trip.

Get the cache viewer with `usePortalViewer()`. The unsubscribe hooks are used as follows:

```tsx
import { usePortalViewer } from "../../core/use-portal-viewer";

const viewer = usePortalViewer();
const preview = usePreviewUnsubscribeToken(
  { param: { workspace: props.workspaceId }, query: { token: token ?? "" } },
  viewer,
);
const process = useProcessUnsubscribeToken(viewer);

if (!token) {
  return <StateView problem={{ kind: "gone" }}>{null}</StateView>;
}

if (process.isSuccess) {
  return <ResultCard titleKey="unsubscribe.done" />;
}

return (
  <StateView loading={preview.isLoading || process.isPending} problem={process.error ?? preview.error ?? null}>
      <ConfirmAction
        labelKey="unsubscribe.confirm"
        onConfirm={() =>
          process.mutateAsync({
            param: { workspace: props.workspaceId },
            json: { token },
          }).then(() => undefined)
        }
      />
  </StateView>
);
```

`StateView` accepts `loading`, `empty`, `problem` and `children`. `ConfirmAction` sends nothing on load, refuses framed clicks and accepts an async `onConfirm`. `ResultCard` accepts `titleKey`, optional children and `status`. A page with a mutation declares `done`; the page generator adds it automatically. Add `unsubscribe.confirm` and `unsubscribe.done` to the generated feature JSON.

Add behavior tests below the generated `describePageContract` call. This runnable shape uses only the test kit:

```tsx
import { expect, it, vi } from "vite-plus/test";
import { stashToken } from "../../core/token-stash";
import { previewUnsubscribeTokenFixture } from "../../api/notifications/preview-unsubscribe-token.fixture";
import { processUnsubscribeTokenFixture } from "../../api/notifications/process-unsubscribe-token.fixture";
import { press } from "../../test/actions";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";

it("sends no unsubscribe request on load", async () => {
  const api = mockApi();
  api.reply(previewUnsubscribeTokenFixture.ok());
  stashToken("workspace_test_1:unsubscribe", "mail_link_value");
  const view = renderPage(UnsubscribePage, meta);
  await view.findByRole("button", { name: /confirm/i });
  expect(api.calls()).toHaveLength(1);
});

it("shows done after confirmation", async () => {
  const api = mockApi();
  api.reply(previewUnsubscribeTokenFixture.ok());
  api.reply(processUnsubscribeTokenFixture.ok());
  api.reply(previewUnsubscribeTokenFixture.ok({ valid: false }));
  stashToken("workspace_test_1:unsubscribe", "mail_link_value");
  const view = renderPage(UnsubscribePage, meta);
  await view.findByRole("button", { name: /confirm/i });
  press(/confirm/i);
  expect(await view.findByRole("status", { name: /unsubscribed/i })).toBeInTheDocument();
  expect(api.calls("processQuillsUnsubscribeToken")).toHaveLength(1);
});

it("refuses confirmation in a frame", async () => {
  const api = mockApi();
  api.reply(previewUnsubscribeTokenFixture.ok());
  stashToken("workspace_test_1:unsubscribe", "mail_link_value");
  vi.stubGlobal("top", {});
  const view = renderPage(UnsubscribePage, meta);
  await view.findByRole("button", { name: /confirm/i });
  press(/confirm/i);
  expect(await view.findByRole("alert", { name: /new tab/i })).toBeInTheDocument();
  expect(api.calls()).toHaveLength(1);
  vi.unstubAllGlobals();
});
```

## Commands

- `feature <name>` creates the English feature resource.
- `query <operationId> --area <area> [--paged] [--poll <seconds>]` creates the operation, fixture, hook and contract tests. Poll intervals below 10 seconds are invalid.
- `mutation <operationId> --area <area> --invalidates <operationId,...> [--optimistic <operationId>]` creates the mutation and hook files and invalidates every declared operation prefix after success.
- `type <area>/<Name> --from <operationId> --at <response.path>` derives a view type from an operation response; an `items[]` segment selects the array item type.
- `page <name> --route <route> --audience <audience> --feature <feature> [--token none|query|fragment] [--mail-linked] [--search key:type,...] [--operations id,...]` creates a declaration, page, contract test and thin route.
- `component [group/]<Name>` creates a shared display component and test.
- `part <page>/<Name>` creates a page-local component and test.
- `form <page>/<Name> --operation <operationId>` derives a Zod schema and defaults from the OpenAPI JSON request body, then creates a `PortalForm` part and test. Add labelled controls for the generated fields.
- `redirect <from> <to>` creates a redirect route and contract test.
- `test <file>` creates the missing contract test for an existing operation, hook, component, part, form, page or redirect without overwriting either file.
- `check [--rule C<n>]` runs the shared conformance scanner and Vite+ AST rules.
- `list [--kind <kind>] [--exceptions]` lists framework files or rule exceptions.
- `migrate [--list]` runs or lists idempotent framework migrations, including the operation-contract input upgrade for files generated before the current contract shape.
- `doctor` checks Node, OpenAPI references and conformance.
- `verify [--api]` runs the ordered W0 verification suite. API lanes use `--api` with a disposable `quills_*` database.
- `seed [--reset]` calls the local-only API portal seed. The seed itself refuses production and non-loopback databases.

The generator exits 0 on success, 1 for a finding or refused write, and 2 for invalid usage. It prints created files, remaining markers and the next check.

## Runtime contract

Pages declare metadata in `pages/<page>/meta.ts`, render `PageFrame` as their root, read data through generated hooks, pass query state through `StateView`, and send writes through `ConfirmAction` or `PortalForm`. Token pages remove the token before any request. Persist a token only when a sign-in round trip is required, and take it once afterward. `PortalGate` is applied by each page according to its audience; public pages do not inherit a private feedback gate.

Imports from upstream web code go only through `apps/web/src/quills/ui/upstream.ts`. Package imports and relative Quills imports are allowed. Routes may import their one Quills page through `@/quills/...`.

### Portal layout, access and branding

`PortalRoute` owns the public-config and access queries. It puts their results in `PortalRuntimeProvider`; child pages read them with `usePortalRuntime()` from `quills/portal/runtime`. The public-config `branding` value satisfies the pure `PortalBranding` type from `quills/core/types`:

```ts
interface PortalBranding {
  logoUrl: string | null;
  theme: {
    themeMode: "light" | "dark" | "user";
    light: Record<string, string>;
    dark: Record<string, string>;
  };
  headerDisplayMode: "logo_and_name" | "logo_only" | "custom_logo";
  headerDisplayName: string | null;
}
```

Connect A5 by adding `branding: PortalBranding` to `PortalShellProps`, importing that type from `../core/types`, and passing `config.branding` from the layout. A kit component must not import an API operation, even as a type. The shell chooses the light or dark map from `themeMode` (for `user`, follow the current document theme), converts each API camel-case key to its existing kebab-case CSS variable, and puts only those variables on the outer portal container. Use the narrow C19 exception required for these runtime workspace variables. Do not write to `document.documentElement`, and do not read or apply `customCss`.

The header behavior is exact:

- `logo_and_name`: show the safe logo when present and the name.
- `logo_only` or `custom_logo`: show the safe logo; use the resolved name as its accessible text. If no logo exists, show the name so the header is not empty.
- The resolved name is `headerDisplayName?.trim() || config.name`.

The shell remains a display component. Query and access state stay in the layout/runtime. A child page applies the gate like this:

```tsx
const portal = usePortalRuntime();
const gated = meta.audience !== "public";

return (
  <StateView
    loading={gated && portal.accessLoading}
    problem={gated ? portal.accessProblem : null}
  >
    <PortalGate
      workspaceId={props.workspaceId}
      audience={meta.audience}
      portalEnabled
      accessGranted={portal.access?.granted ?? false}
      signedIn={portal.viewer.kind === "user"}
    >
      {/* PageFrame and page content */}
    </PortalGate>
  </StateView>
);
```

The `gated` condition is required. Status, help-center, CSAT and unsubscribe pages have the `public` audience: they may use the public config and branding, but access loading, an access denial, or an access request failure must not hide them. Portal, signed-in and teammate pages use the access result.

## Conformance rules

- C1 thin route with one Quills page or layout.
- C2 test beside each operation, hook, component, part, page, redirect and non-trivial helper.
- C3 no visible JSX text literals; use the `quills` namespace.
- C4 every translation key exists and every feature key is used.
- C5 imports respect the upstream adapter and page-part boundary. The test-only router seam permits only `quills/portal/prefetch.test.ts` to import `routeTree.gen.ts`; it proves real generated-tree matching and is not a general upstream-import exception.
- C6 mail path patterns and `mailLinked` declarations agree.
- C7 operations use the typed client and `toPortalProblem`.
- C8 operation keys use `quillsKey` with workspace and viewer.
- C9 token pages write only through `ConfirmAction`.
- C10 generated names follow the naming table in RFC 0002.
- C11 declared operation IDs exist in OpenAPI and are used by the page.
- C12 no `TODO(quills-web)` marker remains.
- C13 one named component per file; shared UI receives data and callbacks through props.
- C14 pages use `PageFrame`, `StateView` and generated hooks.
- C15 tests use the Quills kit and contract helper; no snapshots, test IDs or waits.
- C16 fixtures use fixed safe values and `satisfies` the response type.
- C17 no barrel file and no default export.
- C18 components and pages are at most 200 lines.
- C19 no inline styles, color literals or new CSS.
- C20 declarations include the states required by their query and token behavior.
- C21 portal links use `portalHref` or API `portalPaths`.
- C22 forms use `PortalForm`.
- C23 every kit component appears in the development gallery.

An exception is `// quills-web-allow C18: reason`. C5, C7, C9 and C16 do not allow exceptions. Run `list --exceptions` and include the output in the change report.

## Framework changes

Change the template and rule together. Add an idempotent migration under `migrations/`, update the golden output and this README, run the migration twice, then run `check` and `verify`.

After updating from an older framework checkout, run `node scripts/quills-web/cli.mjs migrate`. Migration `0001-operation-contract-inputs` upgrades early operation tests to the full request, response, method, path, documented-status and network contract. A second run changes zero files.

## Parser decision

Vite+ in this repository supports JavaScript Oxlint plugins. W0 proved it by registering a fork-owned rule through `vite-plus/lint/plugins` and observing `vp lint` report its diagnostic. The active AST rules and config remain in `lib/rules/plugin.mjs` and `vite.config.mjs`. No parser dependency or S3 package seam is needed.
