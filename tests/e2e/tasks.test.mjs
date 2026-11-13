import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  launchBrowser,
  click,
  fill,
  visible,
  hidden,
  value,
  urlMatches,
  jsonRequest,
  until,
  saveFailure,
} from "@kaneo/browser-test";
import { origin, tls, runBrowser } from "./browser.mjs";

async function post(page, path, body) {
  return jsonRequest(page, `/api/${path}`, "POST", body);
}
async function signUp(page) {
  await page.goto(`${origin}/auth/sign-up`);
  const suffix = randomUUID();
  const email = `task-${suffix}@example.com`;
  await post(page, "auth/sign-up/email", {
    name: "Task Tester",
    email,
    password: `Browser-test-${suffix}`,
  });
  return email;
}
async function createWorkspace(page) {
  await signUp(page);
  const workspace = await post(page, "auth/organization/create", {
    name: "Task test workspace",
    slug: `browser-${randomUUID()}`,
  });
  await post(page, "auth/organization/set-active", {
    organizationId: workspace.id,
  });
  await page.goto(`${origin}/dashboard/workspace/${workspace.id}`);
  return workspace.id;
}
async function createProject(page) {
  await click(page, { by: "role", role: "link", name: "All projects" });
  await urlMatches(page, /\/projects$/);
  await click(
    page,
    { by: "role", role: "button", name: "Create project" },
    { first: true },
  );
  await fill(
    page,
    { by: "placeholder", name: "Project name" },
    "Browser project",
  );
  await click(page, { by: "role", role: "button", name: "Create Project" });
  await urlMatches(page, /\/project\/[^/]+\/board$/);
  await visible(page, { by: "title", name: "Add task" }, { first: true });
  return page.url();
}
async function createTask(page, title) {
  await click(page, { by: "title", name: "Add task" }, { first: true });
  await fill(page, { by: "placeholder", name: "Task title" }, title);
  await click(page, { by: "role", role: "button", name: "Create Task" });
  await hidden(page, { by: "placeholder", name: "Task title" });
  await visible(page, { by: "text", name: title });
}
async function editTask(browser, page, title, updated) {
  await click(page, { by: "text", name: title });
  const input = { by: "placeholder", name: "Click to add a title" };
  await value(page, input, title);
  await page.waitForFunction(() => {
    const node = document.querySelector('[placeholder="Click to add a title"]');
    return node && !node.disabled && !node.readOnly;
  });
  await browser
    .monitor(page)
    .response(/^\/api\/task\/title\//, "PUT", () => fill(page, input, updated));
}

test(
  "create a project and task, then persist a task edit",
  { timeout: 90_000 },
  () =>
    runBrowser("task-persistence", async ({ browser, page }) => {
      await createWorkspace(page);
      const boardUrl = await createProject(page);
      await createTask(page, "Plan the release");
      await editTask(
        browser,
        page,
        "Plan the release",
        "Release plan approved",
      );
      await page.reload();
      await value(
        page,
        { by: "placeholder", name: "Click to add a title" },
        "Release plan approved",
      );
      await page.goto(boardUrl);
      await visible(page, { by: "text", name: "Release plan approved" });
      await hidden(page, { by: "text", name: "Plan the release" });
    }),
);

test(
  "another workspace member receives task edits in realtime",
  { timeout: 120_000 },
  () =>
    runBrowser("realtime", async ({ browser, page }) => {
      const workspaceId = await createWorkspace(page);
      const boardUrl = await createProject(page);
      await createTask(page, "Collaborative task");
      const colleague = await launchBrowser({ ignoreHTTPSErrors: tls });
      try {
        const observer = await colleague.newPage();
        const email = await signUp(observer);
        const invitation = await post(page, "auth/organization/invite-member", {
          organizationId: workspaceId,
          email,
          role: "member",
        });
        await post(observer, "auth/organization/accept-invitation", {
          invitationId: invitation.id,
        });
        await post(observer, "auth/organization/set-active", {
          organizationId: workspaceId,
        });
        assert.notDeepEqual(
          await colleague.context.cookies(origin),
          await browser.context.cookies(origin),
          "Members must have isolated sessions",
        );
        const projectId = new URL(boardUrl).pathname
          .split("/project/")[1]
          .split("/")[0];
        const monitor = colleague.monitor(observer);
        await observer.goto(boardUrl);
        await visible(observer, { by: "text", name: "Collaborative task" });
        await until(
          () =>
            [...monitor.sockets.values()].some(
              (socket) =>
                new URL(socket.url).pathname === `/api/ws/${projectId}` &&
                socket.open &&
                socket.ping,
            ),
          "Project websocket keepalive",
          45_000,
        );
        const start = monitor.frames.length;
        await editTask(
          browser,
          page,
          "Collaborative task",
          "Updated by my teammate",
        );
        await until(
          () =>
            monitor.frames.slice(start).some((frame) => {
              if (new URL(frame.url).pathname !== `/api/ws/${projectId}`)
                return false;
              try {
                const event = JSON.parse(frame.payload);
                return (
                  event.type === "TASK_UPDATED" && event.projectId === projectId
                );
              } catch {
                return false;
              }
            }),
          "Real TASK_UPDATED websocket event",
        );
        // No navigation, reload, or focus change: the other member receives the update live.
        await visible(observer, { by: "text", name: "Updated by my teammate" });
        await hidden(observer, { by: "text", name: "Collaborative task" });
      } catch (error) {
        await saveFailure(
          colleague,
          observer,
          new URL("../../.cache/e2e/realtime-observer/", import.meta.url)
            .pathname,
        );
        throw error;
      } finally {
        await colleague.close();
      }
    }),
);
