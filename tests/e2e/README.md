# Browser tests

The suite uses Stagehand 4.4 Chromium and Node's test runner. It exercises real signup,
onboarding, sign-in return paths, workspace/project/task creation, reload persistence,
and another member's actual WebSocket event and visible update without reloading.
Each member has a separate browser profile. No LLM or cloud-browser API key is needed.

## Run locally

Requires Node 24, pnpm 12.18.0, an installed Google Chrome/Chromium browser, and Docker
Compose v2. Set `CHROME_PATH` if Stagehand cannot find the browser.

```sh
pnpm --dir tests/e2e install --frozen-lockfile --ignore-scripts
pnpm --dir tests/e2e setup
pnpm --dir tests/e2e test:security
docker compose -f tests/e2e/compose.yml up --build --wait --wait-timeout 180
pnpm test:e2e
docker compose -f tests/e2e/compose.yml down --volumes
```

The disposable stack is `kaneo-stagehand-e2e`, bound to `http://localhost:18173`.
It creates unique synthetic accounts and workspaces. PostgreSQL uses temporary storage;
no existing database or root `.env` is used. Stop this stack after failed runs too.
Do not run two copies simultaneously. Failures retain a PNG, a Stagehand DOM snapshot,
and runtime/network diagnostics under `.cache/e2e/`. Request bodies and headers are
excluded from network diagnostics. These artifacts replace the former trace viewer.

The shared `scripts/browser-test` package belongs to this isolated pnpm workspace.
The screenshot tool consumes the same package through an npm file dependency. Browser
tooling is not part of the production workspace or application bundle. Security checks
verify the installed driver and absence of retired cloud SDK dependencies; the old
provider-specific FTP, redirect and cache-policy patches were removed with that SDK.

## HTTPS check

The scheduled workflow keeps bundled HTTPS and secure WebSocket coverage. To run it:

```sh
export KANEO_E2E_TLS=true
export COMPOSE_FILE=tests/e2e/compose.yml:tests/e2e/compose.tls.yml
mkdir -p .cache/e2e-tls
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout .cache/e2e-tls/key.pem -out .cache/e2e-tls/cert.pem \
  -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost'
docker compose up --build --wait --wait-timeout 180
pnpm test:e2e
docker compose down --volumes
unset KANEO_E2E_TLS COMPOSE_FILE
```

Only this test mode accepts the disposable self-signed certificate. Certificates stay
outside uploaded reports. The gateway binds `https://localhost:18174`.

## CI

The PR **Chromium smoke tests** check retains its existing display name. The **Stagehand**
workflow runs on main pushes, manual main runs, and daily at 05:43 UTC. Both use the
runner's installed Chromium and upload diagnostics for seven days. Scheduled main runs
retain the existing fail-closed change classifier: only a proven runtime-neutral diff
since a complete successful run less than 24 hours old can skip the browser work.

All browser lanes now use Chromium. The former Windows/macOS cloud matrix and WebKit
coverage are retired; no BrowserStack credentials or service are used. Workflow edits
do not change branch rules. `ci-result` remains the PR gate; the scheduled run does not
add a release gate.

The screenshot and UI review checks retain synthetic API fixtures, external-request
blocking, axe accessibility audits, component framing, and pixel comparisons. Fixture
captures prohibit popups and workers with a document CSP and close synthetic sockets,
including dev-server HMR; real realtime delivery is covered by the separate E2E suite.
Run their
browser infrastructure check with `node --test scripts/ui-review-bot/browser-smoke.test.mjs`
after `npm ci --prefix scripts/ui-review-bot`.

[Stagehand browser configuration](https://docs.stagehand.dev/v4/configuration/browser)
