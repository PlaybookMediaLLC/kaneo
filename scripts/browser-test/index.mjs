import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { attachPage, connectCDP } from "./cdp.mjs";
import { until } from "./queries.mjs";
export * from "./queries.mjs";
export * from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const querySource = await readFile(
  require.resolve("@testing-library/dom/dist/@testing-library/dom.umd.js"),
  "utf8",
);

export async function launchBrowser(options = {}) {
  const {
    colorScheme = "light",
    timezoneId = "UTC",
    reducedMotion = "reduce",
    ...launch
  } = options;
  const browser = await localBrowser.launch({
    headless: true,
    locale: "en-US",
    viewport: { width: 1440, height: 1000 },
    ...launch,
  });
  let cdp;
  try {
    await Stagehand.create({ browser });
    cdp = await connectCDP(browser.cdpUrl);
    await browser.context.addInitScript(querySource);
  } catch (error) {
    cdp?.close();
    await browser.close();
    throw error;
  }
  const monitors = new Map();
  return {
    context: browser.context,
    async newPage() {
      const page = await browser.context.newPage();
      const session = await attachPage(cdp, page);
      await session.send("Network.enable");
      await session.send("Runtime.enable");
      await session.send("Network.setBypassServiceWorker", { bypass: true });
      await session.send("Emulation.setTimezoneOverride", { timezoneId });
      await session.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: colorScheme },
          { name: "prefers-reduced-motion", value: reducedMotion },
        ],
      });
      const monitor = observe(session);
      monitors.set(page, monitor);
      return page;
    },
    monitor(page) {
      const result = monitors.get(page);
      if (!result) throw new Error("Page is not owned by this browser");
      return result;
    },
    async close() {
      cdp.close();
      await browser.close();
    },
  };
}

function observe(session) {
  const errors = [],
    requestErrors = [],
    consoleErrors = [],
    responses = [],
    sockets = new Map(),
    frames = [];
  const requests = new Map();
  session.on("Runtime.exceptionThrown", ({ exceptionDetails: detail }) =>
    errors.push(detail.exception?.description ?? detail.text),
  );
  session.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error")
      consoleErrors.push(
        event.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      );
  });
  session.on("Network.requestWillBeSent", ({ requestId, request, type }) =>
    requests.set(requestId, { url: request.url, method: request.method, type }),
  );
  session.on("Network.responseReceived", ({ requestId, response, type }) =>
    responses.push({
      requestId,
      url: response.url,
      status: response.status,
      type,
      method: requests.get(requestId)?.method,
    }),
  );
  session.on("Network.loadingFailed", ({ requestId, errorText }) => {
    const request = requests.get(requestId);
    if (request)
      requestErrors.push(
        `${request.method} ${new URL(request.url).pathname}: ${errorText}`,
      );
  });
  session.on("Network.webSocketCreated", ({ requestId, url }) =>
    sockets.set(requestId, { url, open: false, ping: false }),
  );
  session.on("Network.webSocketFrameSent", ({ requestId, response }) => {
    const socket = sockets.get(requestId);
    if (socket && response.payloadData === '{"type":"ping"}') {
      socket.open = true;
      socket.ping = true;
    }
  });
  session.on("Network.webSocketFrameReceived", ({ requestId, response }) =>
    frames.push({
      url: sockets.get(requestId)?.url,
      payload: response.payloadData,
    }),
  );
  session.on("Network.webSocketClosed", ({ requestId }) => {
    const socket = sockets.get(requestId);
    if (socket) socket.open = false;
  });
  session.on("Network.webSocketFrameError", ({ errorMessage }) =>
    errors.push(errorMessage),
  );
  return {
    session,
    errors,
    requestErrors,
    consoleErrors,
    responses,
    sockets,
    frames,
    async response(path, method, action) {
      const start = responses.length;
      await action();
      const result = await until(
        () =>
          responses
            .slice(start)
            .find(
              (r) =>
                (path instanceof RegExp
                  ? path.test(new URL(r.url).pathname)
                  : new URL(r.url).pathname === path) && r.method === method,
            ),
        `${method} ${path}`,
      );
      if (result.status < 200 || result.status >= 300)
        throw new Error(`${method} ${path}: ${result.status}`);
      const body = await until(async () => {
        try {
          return await session.send("Network.getResponseBody", {
            requestId: result.requestId,
          });
        } catch {
          return null;
        }
      }, "Response body");
      return JSON.parse(
        body.base64Encoded
          ? Buffer.from(body.body, "base64").toString()
          : body.body,
      );
    },
  };
}

export async function screenshot(page, path, options = {}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await page.screenshot(options));
}
export async function saveFailure(browser, page, directory) {
  await mkdir(directory, { recursive: true });
  await screenshot(page, `${directory}/browser.png`, { fullPage: true }).catch(
    () => {},
  );
  await writeFile(
    `${directory}/snapshot.json`,
    JSON.stringify(await page.snapshot().catch(() => null), null, 2),
  );
  const { errors, requestErrors, consoleErrors, responses } =
    browser.monitor(page);
  await writeFile(
    `${directory}/diagnostics.json`,
    JSON.stringify(
      {
        errors,
        requestErrors,
        consoleErrors,
        responses: responses.map(({ url, status, method, type }) => ({
          path: new URL(url).pathname,
          status,
          method,
          type,
        })),
      },
      null,
      2,
    ),
  );
}
export async function fixedTime(page, date) {
  await page.addInitScript((timestamp) => {
    const NativeDate = Date;
    globalThis.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [timestamp]));
      }
      static now() {
        return timestamp;
      }
    };
  }, new Date(date).valueOf());
}
