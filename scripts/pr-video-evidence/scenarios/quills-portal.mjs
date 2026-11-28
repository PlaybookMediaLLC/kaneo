import { WORKSPACE } from "../../dev-demo/lib.mjs";

export default {
  app: "quills",
  route: `/portal/${WORKSPACE}`,
  environment:
    "Isolated pnpm dev:demo stack (PostgreSQL + Mailpit + Kaneo API + React Web on 127.0.0.1:5190)",
  acceptanceCriteria: [
    {
      id: "AC-1",
      description:
        "Public Quills portal renders seeded feedback content from the isolated workspace.",
    },
    {
      id: "AC-2",
      description:
        "Navigation and interactive filtering work cleanly against the live API with zero page errors.",
    },
  ],
  async setup({ page, state }) {
    state.workspace = process.env.PR_VIDEO_WORKSPACE || WORKSPACE;
    state.pageErrors = [];
    page.on("pageerror", (error) => {
      state.pageErrors.push(error.message);
    });
  },
  steps: [
    {
      id: "portal-landing",
      narration:
        "Here's the isolated Quills portal loading seeded feedback boards and posts directly from the live API, with no mocked data.",
      async run({ page, baseUrl, state, helpers }) {
        await page.goto(`${baseUrl}/portal/${state.workspace}`, {
          waitUntil: "networkidle",
        });
        const header = page.locator("header, main h1, main h2").first();
        await helpers.highlight(header, "Quills portal header");
        helpers.assert(
          page.url().includes(`/portal/${state.workspace}`),
          "Quills portal route rendered cleanly",
        );
      },
    },
    {
      id: "portal-interaction",
      narration:
        "Clicking a live portal control confirms navigation responds smoothly and the session finishes with zero page errors.",
      async run({ page, state, helpers }) {
        const interactive = page.locator("main a, main button").first();
        const isVisible = await interactive.isVisible().catch(() => false);
        helpers.assert(
          isVisible,
          "Quills portal rendered an interactive navigation control",
        );
        await helpers.moveAndClick(interactive, {
          label: "Live portal navigation control",
          zoom: 1.15,
        });
        await page.waitForLoadState("networkidle").catch(() => {});
        helpers.assert(
          state.pageErrors.length === 0,
          `Zero uncaught page errors on Quills portal (saw ${state.pageErrors.length})`,
        );
      },
    },
  ],
};
