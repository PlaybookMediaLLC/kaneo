import { files } from "../../database/quills/schema/files";
import type { ContractEnv } from "../framework/contract";
import { createUpload } from "../framework/files";

// Seed helpers for the file fixtures and the lifecycle test. Not fixtures themselves.

export const image = { contentType: "image/png", size: 1024 };

/** A presigned upload for `purpose` in workspaces A and B. Signing makes no network call. */
export async function uploads(
  env: Pick<ContractEnv, "a" | "b">,
  purpose: Parameters<typeof createUpload>[1]["purpose"],
) {
  const request = { purpose, filename: "image.png", ...image };
  return {
    a: (await createUpload(env.a, request)).key,
    b: (await createUpload(env.b, request)).key,
  };
}

/** A registered file in one workspace, written as its owner. */
export const fileRow = (
  env: ContractEnv,
  workspaceId: string,
  storageKey = env.id("object"),
) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [row] = await db
      .insert(files)
      .values({
        storageKey,
        name: "image.png",
        contentType: "image/png",
        family: "image",
        size: 1024,
        sha256: "0".repeat(64),
        source: "agent",
        uploadedById: actor.principalId,
      })
      .returning({ id: files.id });
    return row!.id;
  });
