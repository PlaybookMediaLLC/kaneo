import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Client, localOrigin, password, ready } from "./http.mjs";

const require = createRequire(
  new URL("../ui-review-bot/package.json", import.meta.url),
);
const { launchBrowser, click, fill, visible, selector, until, saveFailure } =
  await import(require.resolve("@kaneo/browser-test"));
const origin = localOrigin(process.argv[2]);
await ready(origin);
const owner = new Client(origin);
await owner.signup("browser-owner");
const workspace = await owner.json("/api/auth/organization/create", "POST", {
  name: "Browser regression",
  slug: `browser-${Date.now()}`,
});
const outsider = new Client(origin);
await outsider.signup("browser-outsider");
const browser = await launchBrowser();
let page;
try {
  page = await browser.newPage();
  const failures = browser.monitor(page).errors;
  await page.goto(`${origin}/auth/sign-in`);
  await fill(page, { by: "label", name: "Email" }, owner.email);
  await page.locator('input[name="password"]').fill(password);
  await click(page, { by: "role", role: "button", name: /^Sign In$/i });
  await until(
    async () => (await page.url()).includes("/dashboard/"),
    "Signed in dashboard",
  );
  await page.goto(`${origin}/dashboard/workspace/${workspace.id}`);
  await click(page, { by: "role", role: "button", name: "Add project" });
  await visible(page, {
    by: "role",
    role: "dialog",
    name: "Create a new project",
  });
  const dialog = await selector(page, {
    by: "role",
    role: "dialog",
    name: "Create a new project",
  });
  await fill(
    page,
    { by: "placeholder", name: "Project name", within: dialog },
    "Browser regression project",
  );
  const project = await browser
    .monitor(page)
    .response("/api/project", "POST", () =>
      click(page, {
        by: "role",
        role: "button",
        name: "Create Project",
        within: dialog,
      }),
    );
  await page.goto(
    `${origin}/dashboard/workspace/${workspace.id}/project/${project.id}/board`,
  );
  await click(page, { by: "title", name: "Add task" }, { first: true });
  await fill(
    page,
    { by: "placeholder", name: "Task title" },
    "Browser persistence task",
  );
  const task = await browser
    .monitor(page)
    .response(`/api/task/${project.id}`, "POST", () =>
      click(page, { by: "role", role: "button", name: "Create Task" }),
    );
  await page.goto(
    `${origin}/dashboard/workspace/${workspace.id}/project/${project.id}/task/${task.id}`,
  );
  const observer = await browser.newPage();
  const monitor = browser.monitor(observer);
  await observer.goto(await page.url());
  await until(
    () =>
      [...monitor.sockets.values()].some(
        (socket) =>
          new URL(socket.url).pathname === `/api/ws/${project.id}` &&
          socket.open,
      ),
    "Observer websocket",
    45_000,
  );
  await visible(observer, { by: "role", role: "button", name: "To Do" });
  await browser.context.setActivePage(page);
  await click(page, { by: "role", role: "button", name: "To Do" });
  const frameStart = monitor.frames.length;
  await browser
    .monitor(page)
    .response(`/api/task/status/${task.id}`, "PUT", () =>
      click(page, { by: "role", role: "option", name: /^In Progress/ }),
    );
  await until(
    () =>
      monitor.frames.slice(frameStart).some((frame) => {
        try {
          const event = JSON.parse(frame.payload);
          return (
            event.type === "TASK_UPDATED" && event.projectId === project.id
          );
        } catch {
          return false;
        }
      }),
    "Observer TASK_UPDATED event",
  );
  await visible(observer, { by: "role", role: "button", name: "In Progress" });
  failures.push(...monitor.errors);
  await observer.close();
  await page.reload();
  await visible(page, { by: "role", role: "button", name: "In Progress" });
  const persisted = await owner.json(`/api/task/${task.id}`);
  assert.equal(persisted.title, "Browser persistence task");
  assert.equal(persisted.status, "in-progress");
  for (const [path, options] of [
    [`/api/project/${project.id}`, {}],
    [`/api/task/${task.id}`, {}],
    [
      `/api/task/status/${task.id}`,
      { method: "PUT", body: { status: "done" } },
    ],
  ]) {
    const response = await outsider.response(path, options);
    assert.ok(
      [403, 404].includes(response.status),
      `Outsider accessed ${path}: ${response.status}`,
    );
  }
  assert.equal(
    (await owner.json(`/api/task/${task.id}`)).status,
    "in-progress",
  );
  assert.deepEqual(failures, [], "Browser runtime errors");
  console.log(
    "Browser sign-in, project/task creation, status persistence and workspace isolation passed",
  );
} catch (error) {
  if (page) await saveFailure(browser, page, ".cache/ci-results");
  throw error;
} finally {
  await browser.close();
}
