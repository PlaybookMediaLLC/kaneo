import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

export async function until(
  check,
  message = "Browser condition",
  timeout = 15_000,
) {
  const end = Date.now() + timeout;
  let error;
  do {
    try {
      const result = await check();
      if (result) return result;
    } catch (caught) {
      error = caught;
    }
    await setTimeout(100);
  } while (Date.now() < end);
  throw new Error(`${message} timed out`, { cause: error });
}

// Accessible queries are resolved by Testing Library; interactions use Stagehand locators.
export async function selector(
  page,
  target,
  { first = false, optional = false } = {},
) {
  const input = { ...target, first, optional, id: crypto.randomUUID() };
  if (input.name instanceof RegExp)
    input.name = { source: input.name.source, flags: input.name.flags };
  return page.evaluate((query) => {
    const name =
      typeof query.name === "object"
        ? new RegExp(query.name.source, query.name.flags)
        : query.name;
    const root = query.within
      ? document.querySelector(query.within)
      : document.body;
    if (!root) return null;
    const lib = window.TestingLibraryDom;
    const options = { exact: true };
    const methods = {
      label: "queryAllByLabelText",
      text: "queryAllByText",
      placeholder: "queryAllByPlaceholderText",
      title: "queryAllByTitle",
    };
    const nodes =
      query.by === "css"
        ? [...root.querySelectorAll(query.name)]
        : query.by === "role"
          ? lib.queryAllByRole(root, query.role, { ...options, name })
          : lib[methods[query.by]](root, name, options);
    const visible = nodes.filter(
      (node) =>
        node.getClientRects().length &&
        getComputedStyle(node).visibility !== "hidden",
    );
    if (!visible.length) return null;
    if (!query.first && visible.length !== 1)
      throw new Error(`Ambiguous ${query.by} query: ${visible.length} matches`);
    const node = visible[0];
    if (!node.dataset.stagehandTestId) node.dataset.stagehandTestId = query.id;
    return `[data-stagehand-test-id="${node.dataset.stagehandTestId}"]`;
  }, input);
}

export async function find(page, target, options = {}) {
  const css = await until(
    () => selector(page, target, options),
    `Find ${target.by}: ${target.name ?? target.role}`,
    options.timeout,
  );
  return page.locator(css);
}

export async function visible(page, target, options) {
  await find(page, target, options);
}
export async function hidden(page, target) {
  await until(
    async () =>
      !(await selector(page, target, { first: true, optional: true })),
    `Hide ${target.name}`,
  );
}
export async function value(page, target, expected) {
  await until(
    async () => (await (await find(page, target)).inputValue()) === expected,
    `Value ${target.name}`,
  );
}
export async function urlMatches(page, expected) {
  await until(async () => {
    const actual = await page.url();
    return expected instanceof RegExp
      ? expected.test(actual)
      : actual === expected;
  }, "Navigation");
}
export async function click(page, target, options) {
  await (await find(page, target, options)).click();
}
export async function fill(page, target, text) {
  await (await find(page, target)).fill(text);
}
export async function jsonRequest(
  page,
  path,
  method = "GET",
  body = undefined,
) {
  const result = await page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
  assert.ok(
    result.status >= 200 && result.status < 300,
    `Fixture ${method} ${path}: ${result.status}`,
  );
  return result.body;
}
