import { randomUUID } from "node:crypto";
import test from "node:test";
import { click, fill, visible, value, urlMatches } from "@kaneo/browser-test";
import { origin, runBrowser } from "./browser.mjs";

test(
  "sign up, create a workspace with a starter project, and sign in again",
  { timeout: 90_000 },
  () =>
    runBrowser("signup", async ({ browser, page }) => {
      const suffix = randomUUID();
      const email = `browser-${suffix}@example.com`;
      const password = `Browser-test-${suffix}`;
      const workspaceName = `Browser test ${suffix.slice(0, 8)}`;
      await page.goto(`${origin}/auth/sign-up`);
      await fill(page, { by: "label", name: "Name" }, "Browser Tester");
      await fill(page, { by: "label", name: "Email" }, email);
      await page.locator('input[name="password"]').fill(password);
      await click(page, { by: "role", role: "button", name: "Create account" });
      await urlMatches(page, /\/onboarding$/);
      await fill(page, { by: "label", name: "Workspace name" }, workspaceName);
      await click(page, { by: "role", role: "button", name: "Continue" });
      await visible(page, {
        by: "role",
        role: "heading",
        name: "Who's it for?",
      });
      await click(page, { by: "role", role: "button", name: "Continue" });
      await value(
        page,
        { by: "label", name: "Project name" },
        "My first project",
      );
      await click(page, { by: "role", role: "button", name: "Continue" });
      await visible(page, {
        by: "role",
        role: "heading",
        name: `${workspaceName} is ready`,
      });
      await click(page, {
        by: "role",
        role: "button",
        name: `Open ${workspaceName}`,
      });
      await urlMatches(
        page,
        /\/dashboard\/workspace\/[^/]+\/project\/[^/]+\/board$/,
      );
      await visible(page, {
        by: "text",
        name: "Drag this card to the next column",
      });
      await visible(
        page,
        { by: "text", name: "My first project" },
        { first: true },
      );
      const boardUrl = await page.url();
      await page.reload();
      await urlMatches(page, boardUrl);
      await visible(page, { by: "text", name: workspaceName }, { first: true });
      await browser.context.clearCookies();
      await page.goto(boardUrl);
      await urlMatches(page, /\/auth\/sign-in/);
      await fill(page, { by: "label", name: "Email" }, email);
      await page.locator('input[name="password"]').fill(password);
      await click(page, { by: "role", role: "button", name: "Sign in" });
      await urlMatches(page, boardUrl);
      await visible(page, { by: "text", name: workspaceName }, { first: true });
    }),
);
