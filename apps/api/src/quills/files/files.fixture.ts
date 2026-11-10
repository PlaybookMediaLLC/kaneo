import { fixture, type ContractEnv } from "../framework/contract";
import { fileRow, image, uploads } from "./seed.fixture";

const both = async (env: ContractEnv) => ({
  a: await fileRow(env, env.a),
  b: await fileRow(env, env.b),
});
const byId = fixture({
  seed: both,
  valid: ({ a }) => ({ params: { fileId: a } }),
  foreign: ({ b }) => ({ fileId: b }),
});

export const createQuillsFiles = fixture({
  seed: (env) => uploads(env, "file"),
  valid: ({ a }) => ({ body: { key: a, name: "image.png", ...image } }),
  foreign: ({ b }) => ({ key: b }),
});
export const getQuillsFile = byId;
export const createQuillsFilesOpened = byId;
