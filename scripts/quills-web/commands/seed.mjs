import { spawnSync } from "node:child_process";

export function run(root, _args, options = {}) {
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@kaneo/api",
      "exec",
      "tsx",
      "src/quills/dev/seed-portal.ts",
      ...(options.reset ? ["--reset"] : []),
    ],
    { cwd: root, encoding: "utf8", stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`portal seed failed with exit ${result.status ?? 1}`);
  return [];
}
