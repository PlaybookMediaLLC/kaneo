import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { eq } from "drizzle-orm";
import { files } from "../../../database/quills/schema/files";
import { fixture, type ContractEnv } from "../../framework/contract";
import { scene } from "./seed.fixture";

export async function attachmentScene(env: ContractEnv) {
  const s = await scene(env, "portal");
  const a = await env.portalCustomer(env.a, env.customerA);
  const b = await env.portalCustomer(env.b, env.customerB);
  const seed = (workspace: string, owner: typeof a.principalId) =>
    env.scoped(workspace, async (db) => {
      const [row] = await db
        .insert(files)
        .values({
          name: "example.txt",
          storageKey: `quills-fixture/${env.id("file")}.txt`,
          contentType: "text/plain",
          family: "text",
          size: 12,
          sha256: "0".repeat(64),
          source: "portal",
          uploadedById: flexibleToTypeIdSchema("principal").parse(owner),
          previewStatus: "none",
        })
        .returning({ id: files.id });
      return row!.id;
    });
  return {
    ...s,
    fileId: await seed(env.a, a.principalId),
    foreignId: await seed(env.b, b.principalId),
  };
}
export const getQuillsPortalFile = fixture({
  seed: attachmentScene,
  valid: (s) => ({ params: { fileId: s.fileId } }),
  foreign: (s) => ({ fileId: s.foreignId }),
  own: (s) => [s.fileId],
});
export const discardQuillsPortalFile = fixture({
  seed: attachmentScene,
  valid: (s) => ({ params: { fileId: s.fileId } }),
  foreign: (s) => ({ fileId: s.foreignId }),
  own: (s) => [s.fileId],
  probe: (env, s) =>
    env.scoped(env.a, (db) =>
      db.select({ id: files.id }).from(files).where(eq(files.id, s.fileId)),
    ),
});
