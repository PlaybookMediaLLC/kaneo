import { PORTS, WORKSPACE } from "../../dev-demo/lib.mjs";
import { readEnv, secretsFile } from "../../dev-demo/secrets.mjs";

function resolveDemoCredentials() {
  const email = process.env.PR_VIDEO_EMAIL || "portal-demo@example.test";
  if (process.env.PR_VIDEO_PASSWORD) {
    return { email, password: process.env.PR_VIDEO_PASSWORD };
  }
  if (process.env.QUILLS_DEMO_PASSWORD) {
    return { email, password: process.env.QUILLS_DEMO_PASSWORD };
  }
  const fileEnv = readEnv(secretsFile);
  if (fileEnv.QUILLS_DEMO_PASSWORD) {
    return { email, password: fileEnv.QUILLS_DEMO_PASSWORD };
  }
  return { email, password: null };
}

/** Reads the latest 6-digit OTP sent to the local dev:demo Mailpit inbox after requestedAfterMs. */
async function fetchLatestMailpitOtp(
  email,
  requestedAfterMs,
  inboxPort = PORTS.inbox,
) {
  const inboxBase =
    process.env.PR_VIDEO_MAILPIT_URL || `http://127.0.0.1:${inboxPort}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${inboxBase}/api/v1/messages?limit=10`, {
      signal: AbortSignal.timeout(5000),
    });
    if (listRes.ok) {
      const data = await listRes.json();
      const target = (data.messages ?? []).find((msg) => {
        const createdMs = Date.parse(msg.Created ?? "");
        if (Number.isFinite(createdMs) && createdMs < requestedAfterMs) {
          return false;
        }
        return (msg.To ?? []).some(
          (recipient) =>
            String(recipient.Address ?? "").toLowerCase() ===
            email.toLowerCase(),
        );
      });
      if (target?.ID) {
        const msgRes = await fetch(`${inboxBase}/api/v1/message/${target.ID}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (msgRes.ok) {
          const full = await msgRes.json();
          const body = `${full.Text ?? ""} ${full.HTML ?? ""}`;
          const codeMatch = body.match(/\b(\d{6})\b/);
          if (codeMatch) return codeMatch[1];
        }
      }
    }
    await new Promise((done) => setTimeout(done, 400));
  }
  throw new Error(
    `Timed out waiting for sign-in OTP email for ${email} in Mailpit (${inboxBase}).`,
  );
}

export default {
  app: "kaneo",
  route: `/dashboard/workspace/${WORKSPACE} -> /project/:id/board -> /task/:id -> /portal/${WORKSPACE}`,
  environment:
    "Isolated pnpm dev:demo stack (PostgreSQL + Mailpit + Kaneo API + React Web on 127.0.0.1:5190)",
  acceptanceCriteria: [
    {
      id: "AC-1",
      description:
        "Live Playwright capture runs against the real isolated Kaneo application with seeded data, visible cursor, click indicators, highlights, and captions.",
    },
    {
      id: "AC-2",
      description:
        "Project creation enforces empty-title validation (error state) before accepting a valid project name.",
    },
    {
      id: "AC-3",
      description:
        "Task creation and status transition from To Do to In Progress persist across a full browser reload.",
    },
    {
      id: "AC-4",
      description:
        "Shared workspace navigation reaches the live Quills portal in the same isolated stack.",
    },
  ],
  async setup({ state }) {
    state.credentials = resolveDemoCredentials();
    state.workspace = process.env.PR_VIDEO_WORKSPACE || WORKSPACE;
    state.projectName = `Evidence Check ${Date.now().toString().slice(-4)}`;
    state.taskTitle = "Verify narrated PR evidence pipeline";
  },
  steps: [
    {
      id: "context-and-signin",
      narration:
        "Before this change, reviewers had to check out pull request branches locally just to see if the app actually worked. Now we've added a narrated video evidence pipeline and a GitHub check. Let's sign into the isolated Kaneo workspace to confirm live authentication against the real API.",
      async prepare({ page, baseUrl }) {
        await page.goto(`${baseUrl}/auth/sign-in`, {
          waitUntil: "networkidle",
        });
        await page
          .getByLabel("Email")
          .waitFor({ state: "visible", timeout: 15_000 });
      },
      async run({ page, baseUrl, state, helpers }) {
        const emailInput = page.getByLabel("Email");
        await helpers.highlight(emailInput, "Seeded teammate sign-in");
        await emailInput.fill(state.credentials.email);

        const passwordInput = page.locator('input[name="password"]');
        if (await passwordInput.isVisible().catch(() => false)) {
          if (!state.credentials.password) {
            throw new Error(
              `Password sign-in form is active, but no password was found in PR_VIDEO_PASSWORD or ${secretsFile}.`,
            );
          }
          await passwordInput.fill(state.credentials.password);
          const signInButton = page.getByRole("button", { name: /^Sign In$/i });
          await helpers.moveAndClick(signInButton, {
            label: "Sign in to isolated stack",
          });
        } else {
          // dev:demo enables local Mailpit SMTP, so /auth/sign-in renders Email OTP.
          const requestedAfterMs = Date.now() - 2000;
          const continueBtn = page.getByRole("button", {
            name: /Continue with email/i,
          });
          await helpers.moveAndClick(continueBtn, {
            label: "Request Email OTP via local Mailpit",
          });
          await page.waitForURL(/\/auth\/verify-otp/, { timeout: 15_000 });
          const otp = await fetchLatestMailpitOtp(
            state.credentials.email,
            requestedAfterMs,
          );
          const otpInput = page.locator("input[data-input-otp], input").first();
          await helpers.highlight(otpInput, "Enter 6-digit OTP from Mailpit");
          await otpInput.fill(otp);
        }

        await page.waitForURL(/\/dashboard\//, { timeout: 20_000 });
        await page.goto(`${baseUrl}/dashboard/workspace/${state.workspace}`, {
          waitUntil: "networkidle",
        });
        helpers.assert(
          page.url().includes(`/dashboard/workspace/${state.workspace}`),
          "Authenticated teammate reached the seeded Kaneo workspace",
        );
      },
    },
    {
      id: "project-validation-and-create",
      narration:
        "Next, let's check empty-form validation for acceptance criterion two. When we open the Add project dialog with no name yet, Create Project stays disabled. Once we type a valid project name, the button enables and saves the new project to Postgres.",
      async run({ page, baseUrl, state, helpers }) {
        const addProjectBtn = page.getByRole("button", { name: "Add project" });
        await helpers.moveAndClick(addProjectBtn, {
          label: "Open Add project dialog",
        });

        const dialog = page.getByRole("dialog", {
          name: "Create a new project",
        });
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        const createBtn = dialog.getByRole("button", {
          name: "Create Project",
        });

        // Edge case: verify Create Project stays disabled when the project name is empty.
        await helpers.highlight(
          createBtn,
          "Validation guard: disabled when name is empty",
        );
        await page.waitForTimeout(500);
        helpers.assert(
          await createBtn.isDisabled(),
          "Empty project name keeps Create Project button disabled",
        );

        const nameInput = dialog.getByPlaceholder("Project name");
        await helpers.highlight(nameInput, "Enter valid project name");
        await nameInput.fill(state.projectName);
        helpers.assert(
          await createBtn.isEnabled(),
          "Entering a valid project name enables Create Project",
        );

        const [response] = await Promise.all([
          page.waitForResponse(
            (res) =>
              res.url().includes("/api/project") &&
              res.request().method() === "POST",
            { timeout: 15_000 },
          ),
          helpers.moveAndClick(createBtn, { label: "Create Project" }),
        ]);
        helpers.assert(
          response.status() >= 200 && response.status() < 300,
          `POST /api/project returned HTTP ${response.status()}`,
        );
        const created = await response.json();
        state.projectId = created.id;
        await helpers.clearAnnotations();
        await page.goto(
          `${baseUrl}/dashboard/workspace/${state.workspace}/project/${state.projectId}/board`,
          { waitUntil: "networkidle" },
        );
        helpers.assert(
          Boolean(state.projectId),
          "Project board opened for newly created project",
        );
      },
    },
    {
      id: "board-create-task",
      narration:
        "Now we're on the live project board for acceptance criterion three. We'll add a task to the To Do column and verify the card renders right after the API saves it.",
      async run({ page, state, helpers }) {
        const addTaskBtn = page.locator('[title="Add task"]').first();
        await helpers.moveAndClick(addTaskBtn, {
          label: "Add task on Kanban board",
        });

        const titleInput = page.getByPlaceholder("Task title");
        await helpers.highlight(titleInput, "Task title input");
        await titleInput.fill(state.taskTitle);

        const submitBtn = page.getByRole("button", { name: "Create Task" });
        const [response] = await Promise.all([
          page.waitForResponse(
            (res) =>
              res.url().includes(`/api/task/${state.projectId}`) &&
              res.request().method() === "POST",
            { timeout: 15_000 },
          ),
          helpers.moveAndClick(submitBtn, { label: "Create Task" }),
        ]);
        helpers.assert(
          response.status() >= 200 && response.status() < 300,
          `POST /api/task/${state.projectId} returned HTTP ${response.status()}`,
        );
        const task = await response.json();
        state.taskId = task.id;
        const card = page.getByText(state.taskTitle).first();
        await helpers.highlight(card, "Created task visible on board");
        helpers.assert(
          await card.isVisible(),
          "Created task card is rendered on the board",
        );
      },
    },
    {
      id: "task-status-and-reload",
      narration:
        "Inside the task view, we'll zoom in on the status menu, move the task from To Do to In Progress, and do a full page reload to confirm the change actually persisted.",
      async prepare({ page, baseUrl, state, helpers }) {
        await helpers.clearAnnotations();
        await page.goto(
          `${baseUrl}/dashboard/workspace/${state.workspace}/project/${state.projectId}/task/${state.taskId}`,
          { waitUntil: "networkidle" },
        );
        await page
          .getByRole("button", { name: "To Do" })
          .waitFor({ state: "visible", timeout: 15_000 });
      },
      async run({ page, state, helpers }) {
        const statusBtn = page.getByRole("button", { name: "To Do" });
        await helpers.moveAndClick(statusBtn, {
          label: "Change status: To Do -> In Progress",
          zoom: 1.25,
        });

        const option = page.getByRole("option", { name: /^In Progress/ });
        const [response] = await Promise.all([
          page.waitForResponse(
            (res) =>
              res.url().includes(`/api/task/status/${state.taskId}`) &&
              res.request().method() === "PUT",
            { timeout: 15_000 },
          ),
          helpers.moveAndClick(option, { label: "Select In Progress" }),
        ]);
        helpers.assert(
          response.status() >= 200 && response.status() < 300,
          `PUT /api/task/status/${state.taskId} returned HTTP ${response.status()}`,
        );

        await helpers.clearAnnotations();
        await page.reload({ waitUntil: "networkidle" });
        const persistedBtn = page.getByRole("button", { name: "In Progress" });
        await helpers.highlight(
          persistedBtn,
          "Persisted after full page reload",
        );
        helpers.assert(
          await persistedBtn.isVisible(),
          "Task status In Progress persisted after page reload",
        );
      },
    },
    {
      id: "quills-portal-and-summary",
      narration:
        "Finally, jumping over to the Quills portal shows both apps sharing the same isolated workspace. All four acceptance criteria passed. One note on scope: GitHub branch protection stays advisory until you test and turn it on.",
      async prepare({ page, baseUrl, state, helpers }) {
        await helpers.clearAnnotations();
        await page.goto(`${baseUrl}/portal/${state.workspace}`, {
          waitUntil: "networkidle",
        });
        await page
          .locator("h1, h2")
          .first()
          .waitFor({ state: "visible", timeout: 15_000 });
      },
      async run({ page, state, helpers }) {
        const heading = page.locator("h1, h2").first();
        await helpers.highlight(
          heading,
          "Live Quills portal on shared workspace",
        );
        helpers.assert(
          page.url().includes(`/portal/${state.workspace}`),
          "Shared Quills portal loaded cleanly",
        );
      },
    },
  ],
};
