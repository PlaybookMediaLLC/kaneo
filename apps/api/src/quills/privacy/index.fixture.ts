import { principal, user } from "../../database/quills/schema/auth";
import {
  privacyRequests,
  retentionPolicies,
} from "../../database/quills/schema/privacy";
import { fixture } from "../framework/contract";
import { seed as seedConversations } from "../support/conversation-seed.fixture";

type SeedEnv = Parameters<Parameters<typeof fixture>[0]["seed"]>[0];

async function seedCustomer(env: SeedEnv, workspace: string, tag: string) {
  return env.scoped(workspace, async (db) => {
    const [u] = await db
      .insert(user)
      .values({
        name: `Privacy Customer ${tag}`,
        email: `privacy-${tag}-${env.id(tag)}@example.com`,
      })
      .returning({ id: user.id });
    const [p] = await db
      .insert(principal)
      .values({
        userId: u!.id,
        type: "user",
        role: "user",
        displayName: `Privacy Customer ${tag}`,
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    return p!.id;
  });
}

export const listQuillsRetentionPolicies = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const upsertQuillsRetentionPolicy = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      channel: "email",
      action: "delete",
      closedAfterDays: 90,
      spamAfterDays: 30,
      softDeletedAfterDays: 30,
      aiLogsAfterDays: 60,
    },
  }),
});

export const deleteQuillsRetentionPolicy = fixture({
  seed: async (env) => {
    const seedPolicy = (ws: string) =>
      env.scoped(ws, async (db) => {
        const [row] = await db
          .insert(retentionPolicies)
          .values({
            channel: "widget",
            action: "delete",
            closedAfterDays: 60,
          })
          .onConflictDoUpdate({
            target: [retentionPolicies.workspaceId, retentionPolicies.channel],
            set: { closedAfterDays: 60 },
          })
          .returning({ id: retentionPolicies.id });
        return row!.id;
      });
    return {
      aId: await seedPolicy(env.a),
      bId: await seedPolicy(env.b),
    };
  },
  valid: (s) => ({ params: { policyId: s.aId } }),
  foreign: (s) => ({ policyId: s.bId }),
});

export const eraseQuillsCustomer = fixture({
  seed: async (env) => ({
    aPrincipal: await seedCustomer(env, env.a, "erase-a"),
    bPrincipal: await seedCustomer(env, env.b, "erase-b"),
  }),
  valid: (s) => ({
    body: { principalId: s.aPrincipal, mode: "anonymize" },
  }),
  foreign: (s) => ({ principalId: s.bPrincipal }),
});

export const createQuillsPrivacyAccessRequest = fixture({
  seed: async (env) => ({
    aPrincipal: await seedCustomer(env, env.a, "access-a"),
    bPrincipal: await seedCustomer(env, env.b, "access-b"),
  }),
  valid: (s) => ({
    body: { principalId: s.aPrincipal },
  }),
  foreign: (s) => ({ principalId: s.bPrincipal }),
});

export const listQuillsPrivacyRequests = fixture({
  seed: async () => ({}),
  valid: () => ({ query: { limit: "10" } }),
});

export const getQuillsPrivacyRequest = fixture({
  seed: async (env) => {
    const createReq = (ws: string) =>
      env.scoped(ws, async (db) => {
        const [row] = await db
          .insert(privacyRequests)
          .values({
            type: "erasure",
            mode: "anonymize",
            status: "completed",
            summary: { conversations: 1 },
            completedAt: new Date(),
          })
          .returning({ id: privacyRequests.id });
        return row!.id;
      });
    return {
      aId: await createReq(env.a),
      bId: await createReq(env.b),
    };
  },
  valid: (s) => ({ params: { requestId: s.aId } }),
  foreign: (s) => ({ requestId: s.bId }),
});

export const downloadQuillsPrivacyAccessRequest = fixture({
  seed: async (env) => {
    const createReady = (ws: string) =>
      env.scoped(ws, async (db) => {
        const [row] = await db
          .insert(privacyRequests)
          .values({
            type: "access",
            status: "completed",
            exportS3Key: `${ws}/quills/export/privacy-contract.zip`,
            exportFileName: "privacy-contract.zip",
            exportExpiresAt: new Date(Date.now() + 86_400_000),
            summary: { exportBytes: 128 },
            completedAt: new Date(),
          })
          .returning({ id: privacyRequests.id });
        return row!.id;
      });
    return {
      aId: await createReady(env.a),
      bId: await createReady(env.b),
    };
  },
  valid: (s) => ({ params: { requestId: s.aId } }),
  foreign: (s) => ({ requestId: s.bId }),
});

export const redactQuillsConversationMessage = fixture({
  seed: seedConversations,
  valid: (ids) => ({
    params: {
      conversationId: ids.a.conversationId,
      messageId: ids.a.visitorMessageId,
    },
    body: {
      mode: "both",
      reason: "Customer posted card digits",
    },
  }),
  foreign: (ids) => ({
    conversationId: ids.b.conversationId,
    messageId: ids.b.visitorMessageId,
  }),
});

export const requestQuillsPortalPrivacyExport = fixture({
  seed: async () => ({}),
  valid: () => ({}),
  own: () => [],
});

export const getQuillsPortalPrivacyExport = fixture({
  seed: async (env) => {
    const createOwned = (ws: string, principalId: string) =>
      env.scoped(ws, async (db) => {
        const [row] = await db
          .insert(privacyRequests)
          .values({
            type: "access",
            subjectPrincipalId:
              principalId as typeof privacyRequests.$inferInsert.subjectPrincipalId,
            requestedByPrincipalId:
              principalId as typeof privacyRequests.$inferInsert.requestedByPrincipalId,
            status: "completed",
            exportS3Key: `${ws}/quills/export/portal-self.zip`,
            exportFileName: "my-data.zip",
            exportExpiresAt: new Date(Date.now() + 86_400_000),
            summary: { exportBytes: 64 },
            completedAt: new Date(),
          })
          .returning({ id: privacyRequests.id });
        return row!.id;
      });
    const ownCustomer = await env.portalCustomer(env.a, env.customerA);
    const otherCustomer = await env.portalCustomer(env.a, env.customerB);
    const bPrincipal = await seedCustomer(env, env.b, "portal-b");
    return {
      aId: await createOwned(env.a, ownCustomer.principalId),
      otherId: await createOwned(env.a, otherCustomer.principalId),
      bId: await createOwned(env.b, bPrincipal),
    };
  },
  valid: (s) => ({ params: { requestId: s.aId } }),
  foreign: (s) => ({ requestId: s.bId }),
  own: (s) => [s.otherId],
});
