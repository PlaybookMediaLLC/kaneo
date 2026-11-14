import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { CONTAINER, VOLUME, volumeExists } from "./docker.mjs";

const config = join(homedir(), ".config", "kaneo");
// One set of files for the machine, outside the repository: every worktree shares the one container.
export const secretsFile = join(config, "dev-demo.env");
export const aiFile = join(config, "quills-ai.env");
const lockFile = join(config, "dev-demo.lock");

export const readEnv = (file) =>
  existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/** One demo at a time: the runs share the container, the ports and the secrets. */
export function lock() {
  mkdirSync(config, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(lockFile, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(readFileSync(lockFile, "utf8"));
    if (alive(pid))
      throw new Error(`pnpm dev:demo already runs as process ${pid}.`);
    // ponytail: a stale lock is taken over without a second exclusive create.
    writeFileSync(lockFile, String(process.pid));
  }
}

export function unlock() {
  if (
    existsSync(lockFile) &&
    Number(readFileSync(lockFile, "utf8")) === process.pid
  )
    rmSync(lockFile, { force: true });
}

/** Reads the local secrets, and generates and writes the missing ones. */
export function loadSecrets() {
  const saved = readEnv(secretsFile);
  if (!saved.POSTGRES_PASSWORD && volumeExists())
    throw new Error(
      `The volume ${VOLUME} exists, but ${secretsFile} has no database password. Remove both with: docker rm -f ${CONTAINER} && docker volume rm ${VOLUME}`,
    );
  const secrets = {
    AUTH_SECRET: saved.AUTH_SECRET || randomBytes(32).toString("hex"),
    POSTGRES_PASSWORD:
      saved.POSTGRES_PASSWORD || randomBytes(18).toString("base64url"),
    QUILLS_DEMO_PASSWORD:
      saved.QUILLS_DEMO_PASSWORD || randomBytes(12).toString("base64url"),
  };
  if (Object.keys(secrets).some((key) => !saved[key])) {
    writeFileSync(
      secretsFile,
      Object.entries({ ...saved, ...secrets })
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
    chmodSync(secretsFile, 0o600);
  }
  return secrets;
}
