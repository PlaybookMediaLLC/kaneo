import { connect } from "node:net";

// Fixed demo ports. They differ from the usual dev ports, so the demo can run beside `pnpm dev`.
export const PORTS = { db: 54480, api: 1390, web: 5190 };
export const WORKSPACE = "quills_portal_demo";
export const AI_DEFAULTS = {
  QUILLS_AI_BASE_URL: "https://openrouter.ai/api/v1",
  QUILLS_AI_MODEL: "anthropic/claude-sonnet-5.5",
  QUILLS_AI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
};

export function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg !== "--reset" && arg !== "--");
  if (unknown.length)
    throw new Error(
      `Unknown argument ${unknown[0]}. Usage: pnpm dev:demo [--reset]`,
    );
  return { reset: argv.includes("--reset") };
}

/** The QUILLS_AI_ settings of the user's file over the OpenRouter defaults. Null without a key. */
export function aiEnv(fileEnv) {
  if (!fileEnv.QUILLS_AI_API_KEY) return null;
  const own = Object.entries(fileEnv).filter(([key]) =>
    key.startsWith("QUILLS_AI_"),
  );
  return { ...AI_DEFAULTS, ...Object.fromEntries(own) };
}

/** The environment of the API, the seed and the web app. Only the API gets `ai`. */
export function demoEnv(base, secrets, ai, ports = PORTS) {
  // 127.0.0.1, not localhost: the browser keeps the demo's cookies apart from a dev stack on localhost.
  const api = `http://127.0.0.1:${ports.api}`;
  const web = `http://127.0.0.1:${ports.web}`;
  const database = `postgresql://kaneo:${encodeURIComponent(secrets.POSTGRES_PASSWORD)}@127.0.0.1:${ports.db}/kaneo`;
  const env = Object.fromEntries(
    Object.entries(base).filter(([key]) => !key.startsWith("QUILLS_AI_")),
  );
  return {
    ...env,
    NODE_ENV: "development",
    DATABASE_URL: database,
    QUILLS_MIGRATION_DATABASE_URL: database,
    AUTH_SECRET: secrets.AUTH_SECRET,
    QUILLS_DEMO_PASSWORD: secrets.QUILLS_DEMO_PASSWORD,
    KANEO_API_PORT: String(ports.api),
    KANEO_API_URL: api,
    KANEO_INTERNAL_API_URL: api,
    KANEO_CLIENT_URL: web,
    CORS_ORIGINS: web,
    VITE_API_URL: api,
    VITE_CLIENT_URL: web,
    // A root .env cannot turn on AI, send real mail or use a shared Redis: dotenv keeps set values.
    QUILLS_AI_API_KEY: "",
    SMTP_HOST: "",
    EMAIL_SMTP_HOST: "",
    EMAIL_RESEND_API_KEY: "",
    RESEND_API_KEY: "",
    EMAIL_SES_ACCESS_KEY_ID: "",
    REDIS_URL: "",
    REDIS_SENTINELS: "",
    REDIS_CLUSTER_NODES: "",
    ...ai,
  };
}

/** The image of the postgres service in compose.yml. */
export function composeImage(compose) {
  const image = compose.match(
    /^ {2}postgres:\n(?: {4}.*\n)*? {4}image:\s*(\S+)/m,
  )?.[1];
  if (!image) throw new Error("compose.yml has no postgres image");
  return image;
}

/** True when a server accepts connections on the port. */
export function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
