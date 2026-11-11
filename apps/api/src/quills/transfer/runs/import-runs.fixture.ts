import { boards } from "../../../database/quills/schema/boards";
import { fixture, type ContractEnv } from "../../framework/contract";
import { createUpload } from "../../framework/files";
import { bothSides, finishedImport } from "./seed.fixture";

const csv = { contentType: "text/csv", size: 1024 };

/** A presigned CSV upload and a board, in one workspace. */
const side = async (env: ContractEnv, workspaceId: string) => ({
  key: (
    await createUpload(workspaceId, {
      purpose: "file",
      filename: "posts.csv",
      ...csv,
    })
  ).key,
  boardId: await env.scoped(workspaceId, async (db) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Import", slug: env.id("import-board") })
      .returning({ id: boards.id });
    return board!.id;
  }),
});

export const createQuillsImport = fixture({
  seed: async (env) => ({
    a: await side(env, env.a),
    b: await side(env, env.b),
  }),
  valid: ({ a }) => ({
    body: { key: a.key, ...csv, name: "posts.csv", boardId: a.boardId },
  }),
  foreign: ({ b }) => ({ key: b.key, boardId: b.boardId }),
});

export const getQuillsImportRuns = fixture({
  seed: (env, caller: string) => bothSides(env, caller, finishedImport),
  valid: ({ a }) => ({ params: { runId: a } }),
  foreign: ({ b }) => ({ runId: b }),
});
