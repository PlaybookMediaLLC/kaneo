import { spawnSync } from "node:child_process";

function execute(root, label, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${label} failed with exit ${result.status ?? 1}`);
  console.log(`PASSED ${label}`);
}

export function run(root, _args, options = {}) {
  const pnpm = "corepack";
  const node = process.execPath;
  const steps = [
    ["web typecheck", pnpm, ["--filter", "@kaneo/web", "typecheck"]],
    ["web test", pnpm, ["--filter", "@kaneo/web", "test"]],
    ["web build", pnpm, ["--filter", "@kaneo/web", "build"]],
    ["framework tests", node, ["--test", "scripts/quills-web/**/*.test.mjs"]],
    ["conformance", node, ["scripts/quills-web/cli.mjs", "check"]],
    ["Vite+ check", `${root}/node_modules/.bin/vp`, ["check"]],
    ["branding tests", pnpm, ["branding:test"]],
    ["branding check", pnpm, ["branding:check"]],
    ["upstream safety", node, ["scripts/quills-port/check-upstream.mjs"]],
  ];
  if (options.api)
    steps.splice(
      3,
      0,
      ["API typecheck", pnpm, ["--filter", "@kaneo/api", "typecheck"]],
      ["OpenAPI", pnpm, ["openapi:check"]],
      ["Quills API tests", pnpm, ["--filter", "@kaneo/api", "test:quills"]],
    );
  for (const [label, executable, args] of steps)
    execute(
      root,
      label,
      executable,
      executable === pnpm ? ["pnpm", ...args] : args,
    );
  return [];
}
