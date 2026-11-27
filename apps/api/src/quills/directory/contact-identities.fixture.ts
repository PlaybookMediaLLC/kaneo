import { principal, user } from "../../database/quills/schema/auth";
import {
  contactIdentities,
  contactMerges,
} from "../../database/quills/schema/contact-identities";
import { fixture, type ContractEnv } from "../framework/contract";

async function seedContacts(env: ContractEnv) {
  const make = async (ws: string, tag: string) => {
    return env.scoped(ws, async (db) => {
      const [u1] = await db
        .insert(user)
        .values({ name: `Alice ${tag}`, email: `alice-${tag}@example.test` })
        .returning({ id: user.id });
      const [p1] = await db
        .insert(principal)
        .values({
          userId: u1!.id,
          role: "user",
          type: "user",
          displayName: `Alice ${tag}`,
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      const [u2] = await db
        .insert(user)
        .values({
          name: `Alice Alt ${tag}`,
          email: `alice-alt-${tag}@example.test`,
        })
        .returning({ id: user.id });
      const [p2] = await db
        .insert(principal)
        .values({
          userId: u2!.id,
          role: "user",
          type: "user",
          displayName: `Alice Alt ${tag}`,
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      const [ident] = await db
        .insert(contactIdentities)
        .values({
          principalId: p1!.id,
          kind: "email",
          value: `secondary-${tag}@example.test`,
          verified: false,
          source: "manual",
        })
        .returning({ id: contactIdentities.id });
      const [merge] = await db
        .insert(contactMerges)
        .values({
          sourcePrincipalId: p2!.id,
          targetPrincipalId: p1!.id,
          reason: "Fixture merge",
          snapshot: {
            movedIds: {},
            stashedRows: {},
            targetBefore: {
              contactEmail: null,
              companyId: null,
              blockedAt: null,
              blockedByPrincipalId: null,
            },
            movedIdentityIds: [],
          },
          reversibleUntil: new Date(Date.now() + 30 * 86_400_000),
        })
        .returning({ id: contactMerges.id });
      return {
        primaryId: p1!.id,
        secondaryId: p2!.id,
        identityId: ident!.id,
        mergeId: merge!.id,
      };
    });
  };
  return {
    a: await make(env.a, env.id("a")),
    b: await make(env.b, env.id("b")),
  };
}

export const listQuillsContactIdentities = fixture({
  seed: seedContacts,
  valid: (ids) => ({ params: { principalId: ids.a.primaryId } }),
  foreign: (ids) => ({ principalId: ids.b.primaryId }),
});

export const addQuillsContactIdentity = fixture({
  seed: seedContacts,
  valid: (ids) => ({
    params: { principalId: ids.a.primaryId },
    body: {
      kind: "external_id" as const,
      value: `ext_${crypto.randomUUID().slice(0, 12)}`,
    },
  }),
  foreign: (ids) => ({ principalId: ids.b.primaryId }),
});

export const removeQuillsContactIdentity = fixture({
  seed: seedContacts,
  valid: (ids) => ({
    params: { principalId: ids.a.primaryId, identityId: ids.a.identityId },
  }),
  foreign: (ids) => ({
    principalId: ids.b.primaryId,
    identityId: ids.b.identityId,
  }),
});

export const listQuillsDuplicateContacts = fixture({
  seed: seedContacts,
  valid: () => ({}),
});

export const listQuillsContactMerges = fixture({
  seed: seedContacts,
  valid: () => ({}),
});

export const mergeQuillsContacts = fixture({
  seed: seedContacts,
  valid: (ids) => ({
    body: {
      sourcePrincipalIds: [ids.a.secondaryId],
      targetPrincipalId: ids.a.primaryId,
      reason: "Contract test merge",
    },
  }),
  foreign: (ids) => ({ targetPrincipalId: ids.b.primaryId }),
});

export const undoQuillsContactMerge = fixture({
  seed: seedContacts,
  valid: (ids) => ({ params: { mergeId: ids.a.mergeId } }),
  foreign: (ids) => ({ mergeId: ids.b.mergeId }),
});
