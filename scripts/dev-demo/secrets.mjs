import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONTAINER, VOLUME, volumeExists } from "./docker.mjs";
import { parseEnvFile } from "./lib.mjs";

const config = join(homedir(), ".config", "kaneo");
// One file for the machine, outside the repository: every worktree shares the one container.
export const secretsFile = join(config, "dev-demo.env");
export const aiFile = join(config, "quills-ai.env");

export const readEnv = (file) =>
  existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {};

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
    mkdirSync(dirname(secretsFile), { recursive: true, mode: 0o700 });
    writeFileSync(
      secretsFile,
      Object.entries(secrets)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { mode: 0o600 },
    );
  }
  return secrets;
}
