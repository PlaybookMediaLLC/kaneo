import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  AI_DEFAULTS,
  aiEnv,
  composeImage,
  demoEnv,
  isPortInUse,
  parseArgs,
  parseEnvFile,
} from "./lib.mjs";

const secrets = {
  AUTH_SECRET: "auth",
  POSTGRES_PASSWORD: "p@ss/word",
  QUILLS_DEMO_PASSWORD: "demo",
};
const ports = { db: 1, api: 2, web: 3 };

test("parseArgs accepts --reset and refuses other arguments", () => {
  assert.deepEqual(parseArgs([]), { reset: false });
  assert.deepEqual(parseArgs(["--", "--reset"]), { reset: true });
  assert.throws(() => parseArgs(["--rest"]), /Unknown argument --rest/);
});

test("parseEnvFile reads assignments, quotes and export, and skips comments", () => {
  assert.deepEqual(
    parseEnvFile(
      '# key\nQUILLS_AI_API_KEY="sk-1"\n\nexport QUILLS_AI_MODEL = m\nBAD LINE\n',
    ),
    { QUILLS_AI_API_KEY: "sk-1", QUILLS_AI_MODEL: "m" },
  );
});

test("aiEnv is off without a key, and the user's file wins over the defaults", () => {
  assert.equal(aiEnv({}), null);
  assert.equal(aiEnv({ QUILLS_AI_API_KEY: "" }), null);
  assert.deepEqual(aiEnv({ QUILLS_AI_API_KEY: "k", QUILLS_AI_MODEL: "m" }), {
    ...AI_DEFAULTS,
    QUILLS_AI_API_KEY: "k",
    QUILLS_AI_MODEL: "m",
  });
});

test("demoEnv points every URL and the database at the demo stack", () => {
  const env = demoEnv(
    { PATH: "/bin", QUILLS_AI_API_KEY: "shell", SMTP_HOST: "mail" },
    secrets,
    null,
    ports,
  );
  const database = "postgresql://kaneo:p%40ss%2Fword@127.0.0.1:1/kaneo";
  assert.equal(env.PATH, "/bin");
  assert.equal(env.DATABASE_URL, database);
  assert.equal(env.QUILLS_MIGRATION_DATABASE_URL, database);
  assert.equal(env.AUTH_SECRET, "auth");
  assert.equal(env.QUILLS_DEMO_PASSWORD, "demo");
  assert.equal(env.KANEO_API_PORT, "2");
  for (const key of ["KANEO_API_URL", "KANEO_INTERNAL_API_URL", "VITE_API_URL"])
    assert.equal(env[key], "http://127.0.0.1:2");
  for (const key of ["KANEO_CLIENT_URL", "CORS_ORIGINS", "VITE_CLIENT_URL"])
    assert.equal(env[key], "http://127.0.0.1:3");
  assert.equal(env.SMTP_HOST, "");
  assert.equal(env.REDIS_URL, "");
  // AI off: a key from the shell does not turn it on.
  assert.equal(env.QUILLS_AI_API_KEY, undefined);
});

test("demoEnv adds the AI settings when AI is on", () => {
  const env = demoEnv({}, secrets, aiEnv({ QUILLS_AI_API_KEY: "k" }), ports);
  assert.equal(env.QUILLS_AI_API_KEY, "k");
  assert.equal(env.QUILLS_AI_BASE_URL, "https://openrouter.ai/api/v1");
});

test("composeImage reads the postgres image of the repository's compose.yml", () => {
  const compose = readFileSync(
    new URL("../../compose.yml", import.meta.url),
    "utf8",
  );
  assert.match(composeImage(compose), /^pgvector\/pgvector:/);
  assert.throws(() => composeImage("services:\n  web:\n    image: x\n"));
});

test("isPortInUse is true only while a server listens", async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  const { port } = server.address();
  assert.equal(await isPortInUse(port), true);
  await new Promise((done) => server.close(done));
  assert.equal(await isPortInUse(port), false);
});
