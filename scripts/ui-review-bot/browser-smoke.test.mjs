import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  launchBrowser,
  click,
  fill,
  visible,
  screenshot,
  until,
} from "@kaneo/browser-test";
import { installFixtures } from "./fixtures.mjs";
import { auditAccessibility } from "./accessibility.mjs";
import { captureFrame } from "./framing.mjs";
import { capture } from "./runner.mjs";

test(
  "Stagehand controls, isolated sessions, fixture boundaries, screenshots and accessibility",
  { timeout: 45_000 },
  async () => {
    const hits = [];
    const server = createServer((request, response) => {
      hits.push({ path: request.url, referrer: request.headers.referer });
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><html lang="en"><head><meta name="referrer" content="no-referrer"><title>Browser check</title></head><body><main><h1>Browser check</h1><label>Name<input id="name"></label><button onclick="document.querySelector(\'output\').textContent=\'Saved\'">Save</button><output></output></main></body></html>',
      );
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const diagnostics = { unhandled: [], blocked: [] };
      await installFixtures(browser, page, origin, diagnostics);
      await page.goto(`${origin}/?token=synthetic-token`);
      await fill(page, { by: "label", name: "Name" }, "Test User");
      await click(page, { by: "role", role: "button", name: "Save" });
      await visible(page, { by: "text", name: "Saved" });
      const frame = await captureFrame(page, { by: "label", name: "Name" });
      assert.ok(frame.width > 0);
      const output = "/tmp/kaneo-stagehand-smoke.png";
      await screenshot(page, output);
      assert.ok((await readFile(output)).length > 100);
      assert.equal((await auditAccessibility(page)).status, "complete");
      const crossOriginStatus = await page.evaluate(
        async () =>
          (
            await fetch("http://127.0.0.1:4799/api/config", {
              credentials: "include",
              headers: { "X-Kaneo-Window-Id": "fixture" },
            })
          ).status,
      );
      assert.equal(crossOriginStatus, 200);
      const closed = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const socket = new WebSocket("wss://example.invalid/blocked");
            socket.onclose = () =>
              resolve(socket.readyState === WebSocket.CLOSED);
          }),
      );
      assert.equal(closed, true);
      const unknown = await page.evaluate(
        async () => (await fetch("/api/unknown-fixture")).status,
      );
      assert.equal(unknown, 501);
      assert.equal(diagnostics.unhandled.length, 1);
      const blocked = await page.evaluate(async () => {
        try {
          await fetch("https://example.invalid/blocked");
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(blocked, true);
      assert.equal(diagnostics.blocked.length, 1);
      await page.evaluate(() => fetch("/probe"));
      assert.equal(
        hits.find((hit) => hit.path === "/probe").referrer,
        undefined,
      );
      await browser.context.addCookies([
        { name: "isolation", value: "owner", url: origin },
      ]);
      const other = await launchBrowser();
      try {
        assert.equal((await other.context.cookies(origin)).length, 0);
      } finally {
        await other.close();
      }
      assert.deepEqual(browser.monitor(page).errors, []);
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);

test("the application installs no-referrer before scripts and preloadable assets", async () => {
  const html = await readFile(
    new URL("../../apps/web/index.html", import.meta.url),
    "utf8",
  );
  const policy = html.indexOf('<meta name="referrer" content="no-referrer"');
  assert.ok(policy >= 0);
  assert.ok(policy < html.search(/<(?:script|link)\b/));
});

test(
  "fixture documents prohibit popup and worker network escapes",
  { timeout: 60_000 },
  async () => {
    const escaped = [];
    const external = createServer((request, response) => {
      escaped.push(request.url);
      response.end("external");
    }).listen(0, "127.0.0.1");
    await once(external, "listening");
    const destination = `http://127.0.0.1:${external.address().port}`;
    const localHits = [];
    const local = createServer((request, response) => {
      localHits.push(request.url);
      response.setHeader("content-type", "text/html");
      response.end(
        `<!doctype html><title>Fixture boundary</title><main>Fixture boundary check<button onclick="runBoundary()">Check isolation</button></main><script>
          async function runBoundary() {
            window.boundaryResult = await (async (destination) => {
        const popup = window.open(destination + "/popup") === null;
        const source = URL.createObjectURL(
          new Blob(["fetch(" + JSON.stringify(destination + "/worker") + ")"], {
            type: "text/javascript",
          }),
        );
        const violations = [];
        document.addEventListener("securitypolicyviolation", (event) =>
          violations.push(event.effectiveDirective),
        );
        for (const Constructor of [Worker, SharedWorker]) {
          try {
            new Constructor(source);
          } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const worker =
          violations.filter((directive) => directive === "worker-src").length >=
          2;
        const sharedWorker = worker;
        let serviceWorker = false;
        try {
          await navigator.serviceWorker.register("/worker.js");
        } catch {
          serviceWorker = true;
        }
        URL.revokeObjectURL(source);
        return { popup, worker, sharedWorker, serviceWorker };
      })(${JSON.stringify(destination)});
          }
        </script>`,
      );
    }).listen(0, "127.0.0.1");
    await once(local, "listening");
    const origin = `http://127.0.0.1:${local.address().port}`;
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await installFixtures(browser, page, origin, {
        unhandled: [],
        blocked: [],
      });
      await page.goto(origin);
      await page.locator("button").click();
      const blocked = await until(
        () => page.evaluate(() => window.boundaryResult),
        "Browser fixture isolation",
      ).catch((error) => {
        console.log({
          errors: browser.monitor(page).errors,
          console: browser.monitor(page).consoleErrors,
          escaped,
        });
        throw error;
      });
      assert.deepEqual(blocked, {
        popup: true,
        worker: true,
        sharedWorker: true,
        serviceWorker: true,
      });
      assert.deepEqual(escaped, []);
      assert.ok(!localHits.includes("/worker.js"));
    } finally {
      await browser.close();
      external.close();
      local.close();
      await Promise.all([once(external, "close"), once(local, "close")]);
    }
  },
);

test(
  "capture retains runtime failures after a recoverable Vite startup retry",
  { timeout: 90_000 },
  async () => {
    let scripts = 0;
    const server = createServer((request, response) => {
      if (request.url.startsWith("/node_modules/.vite/")) {
        response.writeHead(++scripts === 1 ? 504 : 200, {
          "content-type": "text/javascript",
        });
        response.end("");
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><html lang="en"><title>Retry check</title><script src="/node_modules/.vite/deps/check.js"></script><main><h1>Runtime error check</h1><button role="option" aria-selected="false" onclick="this.setAttribute(\'aria-selected\', this.getAttribute(\'aria-selected\') !== \'true\'); document.getElementById(\'selected\').textContent=this.getAttribute(\'aria-selected\')">Engineering</button><output id="selected"></output><button onclick="document.getElementById(\'count\').textContent=Number(document.getElementById(\'count\').textContent)+1">Activate once</button><output id="count">0</output><button onclick="throw new Error(\'runtime-after-retry\')">Throw runtime error</button></main></html>',
      );
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const result = await capture(
        `http://127.0.0.1:${server.address().port}`,
        {
          beforePath: "/",
          afterPath: "/",
          actions: [
            { type: "click", by: "role", role: "option", name: "Engineering" },
            {
              type: "press",
              by: "role",
              role: "option",
              name: "Engineering",
              value: "Escape",
            },
            {
              type: "press",
              by: "role",
              role: "button",
              name: "Activate once",
              value: "Enter",
            },
            {
              type: "click",
              by: "role",
              role: "button",
              name: "Throw runtime error",
            },
          ],
        },
        "before",
        "/tmp/kaneo-stagehand-retry.png",
        new AbortController().signal,
      );
      assert.ok(result.actions.every((action) => action.ok));
      assert.match(result.text, /Engineering\s*true\s*Activate once\s*1/);
      assert.equal(result.startupRetries, 1);
      assert.equal(result.ok, false);
      assert.ok(
        result.errors.some((error) => error.includes("runtime-after-retry")),
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  },
);
