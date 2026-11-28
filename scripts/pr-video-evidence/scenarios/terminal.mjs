import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

const SECRET_ENV_PATTERN =
  /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|COOKIE|AUTH)/i;

function sanitizeEnv(baseEnv) {
  const clean = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!SECRET_ENV_PATTERN.test(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

export function redactTerminalOutput(text) {
  return stripVTControlCharacters(String(text ?? ""))
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]+\b/g,
      "[REDACTED_GH_TOKEN]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]");
}

/**
 * Helper for backend, API, database, or infrastructure PRs without a web UI.
 * Executes real commands (preferring argv array with shell: false) and renders redacted output at 1920x1080.
 */
export function createTerminalScenario({
  title,
  route = "backend / cli",
  environment = "Isolated local test environment",
  acceptanceCriteria = [],
  commands = [],
}) {
  return {
    app: "terminal",
    route,
    environment,
    acceptanceCriteria,
    async setup({ page }) {
      await page.setContent(`
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <style>
              body {
                margin: 0;
                background: #0b1120;
                color: #e2e8f0;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                padding: 40px 56px 110px;
                box-sizing: border-box;
              }
              .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #1e293b;
                padding-bottom: 16px;
                margin-bottom: 24px;
              }
              .title { font-size: 24px; font-weight: 700; color: #f8fafc; }
              .badge { font-size: 14px; color: #93c5fd; background: #1e293b; padding: 6px 12px; border-radius: 6px; }
              .cmd-block {
                background: #0f172a;
                border: 1px solid #1e293b;
                border-radius: 10px;
                padding: 20px 24px;
                margin-bottom: 20px;
              }
              .cmd-line { font-size: 18px; color: #38bdf8; font-weight: 600; margin-bottom: 12px; }
              .cmd-out { font-size: 15px; line-height: 1.5; white-space: pre-wrap; color: #cbd5e1; max-height: 520px; overflow: hidden; }
              .status-ok { color: #4ade80; font-weight: 700; margin-top: 12px; font-size: 15px; }
              .status-fail { color: #f87171; font-weight: 700; margin-top: 12px; font-size: 15px; }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="title" id="term-title"></div>
              <div class="badge" id="term-env"></div>
            </div>
            <div id="terminal-body"></div>
          </body>
        </html>
      `);
      await page.evaluate(
        ({ heading, envLabel }) => {
          document.getElementById("term-title").textContent = heading;
          document.getElementById("term-env").textContent = envLabel;
        },
        { heading: String(title ?? ""), envLabel: String(environment ?? "") },
      );
    },
    steps: commands.map((entry) => ({
      id: entry.id,
      narration: entry.narration,
      async run({ page, helpers }) {
        const execOpts = {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          timeout: entry.timeoutMs ?? 120_000,
          env: sanitizeEnv(process.env),
        };
        const displayCommand = Array.isArray(entry.argv)
          ? entry.argv.join(" ")
          : String(entry.command ?? "");
        const result = Array.isArray(entry.argv)
          ? spawnSync(entry.argv[0], entry.argv.slice(1), {
              ...execOpts,
              shell: false,
            })
          : spawnSync(displayCommand, { ...execOpts, shell: true });

        const rawOutput = result.error
          ? `Execution error: ${result.error.message}`
          : `${result.stdout ?? ""}${result.stderr ?? ""}`;
        const combined = redactTerminalOutput(rawOutput).trim().slice(-2400);
        const passed =
          !result.error && result.status === (entry.expectedExitCode ?? 0);

        await page.evaluate(
          ({ command, output, exitCode, ok }) => {
            const container = document.getElementById("terminal-body");
            if (!container) return;
            const block = document.createElement("div");
            block.className = "cmd-block";
            const cmdLine = document.createElement("div");
            cmdLine.className = "cmd-line";
            cmdLine.textContent = `$ ${command}`;
            const cmdOut = document.createElement("div");
            cmdOut.className = "cmd-out";
            cmdOut.textContent = output || "(no output)";
            const status = document.createElement("div");
            status.className = ok ? "status-ok" : "status-fail";
            status.textContent = `Exit code: ${exitCode ?? "error"} (${ok ? "PASS" : "FAIL"})`;
            block.append(cmdLine, cmdOut, status);
            container.replaceChildren(block);
          },
          {
            command: displayCommand,
            output: combined,
            exitCode: result.status,
            ok: passed,
          },
        );
        const block = page.locator(".cmd-block");
        await helpers.highlight(block, entry.label || entry.id);
        helpers.assert(
          passed,
          `Command "${displayCommand}" exited with ${result.status ?? result.error?.message} (expected ${entry.expectedExitCode ?? 0})`,
        );
      },
    })),
  };
}
