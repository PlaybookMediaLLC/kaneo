import assert from "node:assert/strict";
import test from "node:test";
import { click, fill, launchBrowser } from "@kaneo/browser-test";

test("actions resolve a replacement element without dispatching twice", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(
      `data:text/html,${encodeURIComponent('<button>Send</button><input aria-label="Message">')}`,
    );
    await page.evaluate(() => {
      globalThis.clicks = 0;
      document.addEventListener("click", () => globalThis.clicks++);
    });
    for (const method of ["click", "fill"]) {
      let attempts = 0;
      const replacingPage = {
        evaluate: page.evaluate.bind(page),
        locator(css) {
          return {
            async [method](...args) {
              if (attempts++ === 0) {
                await page.evaluate((selector) => {
                  const old = document.querySelector(selector);
                  const replacement = old.cloneNode(true);
                  delete replacement.dataset.stagehandTestId;
                  old.replaceWith(replacement);
                }, css);
              }
              return page.locator(css)[method](...args);
            },
          };
        },
      };
      if (method === "click") {
        await click(replacingPage, {
          by: "role",
          role: "button",
          name: "Send",
        });
      } else {
        await fill(replacingPage, { by: "label", name: "Message" }, "Once");
      }
      assert.equal(attempts, 2);
    }
    assert.equal(await page.evaluate(() => globalThis.clicks), 1);
    assert.equal(await page.locator("input").inputValue(), "Once");
  } finally {
    await browser.close();
  }
});

for (const method of ["click", "fill"]) {
  test(`${method} does not replay an unknown failure`, async () => {
    const failure = new Error("Response lost after input dispatch");
    let attempts = 0;
    const page = {
      evaluate: async () => '[data-stagehand-test-id="target"]',
      locator: () => ({
        async [method]() {
          attempts++;
          throw failure;
        },
      }),
    };
    await assert.rejects(
      () =>
        method === "click"
          ? click(page, { by: "css", name: "button" })
          : fill(page, { by: "css", name: "input" }, "Once"),
      (error) => error === failure,
    );
    assert.equal(attempts, 1);
  });
}

test("removed-element retries stop after one replacement", async () => {
  const css = '[data-stagehand-test-id="target"]';
  let attempts = 0;
  const failure = new Error(
    `Could not find an element for the given xPath(s): ${css}`,
    {
      cause: { code: -32603 },
    },
  );
  const page = {
    evaluate: async () => css,
    locator: () => ({
      async click() {
        attempts++;
        throw failure;
      },
    }),
  };
  await assert.rejects(
    () => click(page, { by: "css", name: "button" }),
    (error) => error === failure,
  );
  assert.equal(attempts, 2);
});
