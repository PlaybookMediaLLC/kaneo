import { verifiedReleases } from "../../database/quills/schema/releases";
import { fixture, type ContractEnv } from "../framework/contract";

let releaseSeq = 0;

async function seedDraftRelease(env: ContractEnv, ws: string, version: string) {
  return env.scoped(ws, async (db) => {
    const [row] = await db
      .insert(verifiedReleases)
      .values({
        version,
        title: `Release ${version}`,
        source: "manual",
        status: "draft",
      })
      .onConflictDoUpdate({
        target: [verifiedReleases.workspaceId, verifiedReleases.version],
        set: { status: "draft", title: `Release ${version}` },
      })
      .returning({ id: verifiedReleases.id });
    return row!.id;
  });
}

export const listQuillsVerifiedReleases = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const createQuillsVerifiedRelease = fixture({
  seed: async (env) => ({
    prefix: env
      .id("rel")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 8),
  }),
  valid: (s) => ({
    body: {
      version: `v1.0.${++releaseSeq}-${s.prefix}`,
      title: "Verified Contract Release",
      source: "manual",
    },
  }),
});

export const approveQuillsVerifiedRelease = fixture({
  seed: async (env) => ({
    aId: await seedDraftRelease(env, env.a, `v2.0.${++releaseSeq}-a`),
    bId: await seedDraftRelease(env, env.b, `v2.0.${++releaseSeq}-b`),
  }),
  valid: (s) => ({
    params: { releaseId: s.aId },
    body: {
      title: "Approved Contract Release",
      content: "Everything shipped smoothly.",
    },
  }),
  foreign: (s) => ({ releaseId: s.bId }),
});
