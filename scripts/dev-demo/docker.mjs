import { spawnSync } from "node:child_process";

export const CONTAINER = "kaneo-demo-postgres";
export const VOLUME = "kaneo-demo-postgres-data";

const docker = (args, options = {}) =>
  spawnSync("docker", args, { encoding: "utf8", ...options });

function containerState() {
  const result = docker(["inspect", "-f", "{{.State.Status}}", CONTAINER]);
  return result.status === 0 ? result.stdout.trim() : "missing";
}

export const volumeExists = () =>
  docker(["volume", "inspect", VOLUME]).status === 0;

/** Creates or starts the demo container only. Returns true when this call started it. */
export function startContainer({ image, port, password }) {
  if (docker(["info"]).status !== 0)
    throw new Error("Docker does not answer. Start Docker and try again.");
  const state = containerState();
  if (state === "running") return false;
  const result =
    state === "missing"
      ? docker(
          [
            "run",
            "--detach",
            "--name",
            CONTAINER,
            "--publish",
            `127.0.0.1:${port}:5432`,
            "--volume",
            `${VOLUME}:/var/lib/postgresql/data`,
            "--env",
            "POSTGRES_USER=kaneo",
            "--env",
            "POSTGRES_DB=kaneo",
            // The value comes from this process, so it is not in the command line.
            "--env",
            "POSTGRES_PASSWORD",
            "--health-cmd",
            "pg_isready -U kaneo -d kaneo",
            "--health-interval",
            "2s",
            "--health-retries",
            "60",
            image,
          ],
          { env: { ...process.env, POSTGRES_PASSWORD: password } },
        )
      : docker(["start", CONTAINER]);
  if (result.status !== 0)
    throw new Error(
      `Docker could not start ${CONTAINER}: ${result.stderr.trim()}`,
    );
  return true;
}

export async function waitHealthy(seconds = 120) {
  for (let second = 0; second < seconds; second++) {
    const health = docker([
      "inspect",
      "-f",
      "{{.State.Health.Status}}",
      CONTAINER,
    ]);
    if (health.stdout.trim() === "healthy") return;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`${CONTAINER} is not healthy after ${seconds} seconds`);
}

export const stopContainer = () => docker(["stop", CONTAINER]);
