#!/usr/bin/env node
// pnpm dev:demo [--reset]: a seeded local Kaneo and Quills stack on its own PostgreSQL container.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { startContainer, stopContainer, waitHealthy } from "./docker.mjs";
import {
  aiEnv,
  composeImage,
  demoEnv,
  isPortInUse,
  parseArgs,
  PORTS,
  WORKSPACE,
} from "./lib.mjs";
import {
  aiFile,
  loadSecrets,
  lock,
  readEnv,
  secretsFile,
  unlock,
} from "./secrets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const children = [];
let stopping = false;
let ownsContainer = false;

const log = (line) => console.log(`[demo] ${line}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Starts a command in its own process group, so a stop also reaches the processes it starts. */
function run(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    createInterface({ input: stream }).on("line", (line) =>
      console.log(`[${name}] ${line}`),
    );
  child.exited = new Promise((done) => child.once("exit", done));
  children.push(child);
  return child;
}

async function finish(child, what) {
  const code = await child.exited;
  if (code !== 0) throw new Error(`${what} failed with exit code ${code}`);
}

async function waitFor(url, child, seconds) {
  for (let second = 0; second < seconds; second++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`The process for ${url} stopped`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${url} did not answer in ${seconds} seconds`);
}

const signalGroup = (child, signal) => {
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
};

async function stop(code) {
  if (stopping) return;
  stopping = true;
  log("Stopping");
  for (const child of children) signalGroup(child, "SIGTERM");
  for (let wait = 0; wait < 30; wait++) {
    if (!children.some((child) => signalGroup(child, 0))) break;
    await sleep(500);
  }
  for (const child of children) signalGroup(child, "SIGKILL");
  if (ownsContainer) stopContainer();
  unlock();
  process.exit(code);
}

async function main() {
  const { reset } = parseArgs(process.argv.slice(2));
  lock();
  for (const [name, port] of [
    ["API", PORTS.api],
    ["web app", PORTS.web],
  ])
    if (await isPortInUse(port))
      throw new Error(
        `Port ${port} for the ${name} is in use. Stop the process that uses it and try again.`,
      );
  const ai = aiEnv(readEnv(aiFile));
  log(
    ai ? "AI on" : `AI off. To turn it on, put QUILLS_AI_API_KEY in ${aiFile}`,
  );
  const secrets = loadSecrets();
  ownsContainer = startContainer({
    image: composeImage(readFileSync(join(root, "compose.yml"), "utf8")),
    port: PORTS.db,
    password: secrets.POSTGRES_PASSWORD,
  });
  await waitHealthy();
  const env = demoEnv(process.env, secrets, null);
  await finish(
    // The root build:dependencies filter matches no package, so name the two apps here.
    run(
      "build",
      "pnpm",
      [
        "exec",
        "vp",
        "run",
        "--filter",
        "@kaneo/api^...",
        "--filter",
        "@kaneo/web^...",
        "build",
      ],
      env,
    ),
    "The package build",
  );
  const api = run(
    "api",
    "pnpm",
    ["--filter", "@kaneo/api", "dev"],
    demoEnv(process.env, secrets, ai),
  );
  const web = run(
    "web",
    "pnpm",
    [
      "--filter",
      "@kaneo/web",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORTS.web),
      "--strictPort",
    ],
    env,
  );
  for (const [name, child] of [
    ["The API", api],
    ["The web app", web],
  ])
    child.exited.then((code) => {
      if (stopping) return;
      log(`${name} stopped with exit code ${code}`);
      void stop(1);
    });
  // The API runs the Kaneo and Quills migrations before it answers.
  await waitFor(`http://127.0.0.1:${PORTS.api}/api/health`, api, 300);
  await finish(
    run(
      "seed",
      process.execPath,
      ["scripts/quills-web/cli.mjs", "seed", ...(reset ? ["--reset"] : [])],
      env,
    ),
    "The seed",
  );
  await waitFor(`http://127.0.0.1:${PORTS.web}/`, web, 120);
  const app = env.KANEO_CLIENT_URL;
  log(`Ready. AI ${ai ? "on" : "off"}.`);
  log(`  Portal:        ${app}/portal/${WORKSPACE}`);
  log(`  Teammate app:  ${app}/feedback/${WORKSPACE}`);
  log(`  Kaneo:         ${app}/dashboard/workspace/${WORKSPACE}`);
  log(`  API health:    ${env.KANEO_API_URL}/api/health`);
  log(`Local test accounts. The password is in ${secretsFile}.`);
  log(`  Teammate:  portal-demo@example.test  ${secrets.QUILLS_DEMO_PASSWORD}`);
  log(
    `  Customer:  portal-customer@example.test  ${secrets.QUILLS_DEMO_PASSWORD}`,
  );
  log("Press Ctrl-C to stop.");
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
// The children run in their own sessions, so a closed terminal reaches only this process.
process.on("SIGHUP", () => void stop(0));
main().catch((error) => {
  console.error(`[demo] ${error.message}`);
  void stop(1);
});
