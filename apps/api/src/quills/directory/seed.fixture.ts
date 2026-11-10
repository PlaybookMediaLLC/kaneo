import { principal, user } from "../../database/quills/schema/auth";
import { companies } from "../../database/quills/schema/companies";
import { segments, userSegments } from "../../database/quills/schema/segments";
import {
  userTagAssignments,
  userTags,
} from "../../database/quills/schema/user-tags";
import type { ContractEnv } from "../framework/contract";

// Seed helpers for directory fixtures and feature tests. Not fixtures themselves.

/** A customer (or a lead) in one workspace. Returns its principal ID. */
export function customer(
  env: ContractEnv,
  workspaceId: string,
  options: { lead?: boolean; email?: string; companyId?: string } = {},
) {
  return env.scoped(workspaceId, async (db) => {
    const [identity] = await db
      .insert(user)
      .values({
        name: "Contract Customer",
        email:
          options.email ??
          (options.lead
            ? `${env.id("lead")}@anon.quills.io`
            : `${env.id("customer")}@example.test`),
      })
      .returning({ id: user.id });
    const [row] = await db
      .insert(principal)
      .values({
        userId: identity!.id,
        role: "user",
        type: options.lead ? "anonymous" : "user",
        displayName: "Contract Customer",
        contactEmail: options.lead ? `${env.id("contact")}@example.test` : null,
        companyId: options.companyId as never,
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    return row!.id;
  });
}

/** A customer in each workspace. */
export const customers = async (env: ContractEnv) => ({
  a: await customer(env, env.a),
  b: await customer(env, env.b),
});

export const company = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(companies)
      .values({ name: env.id("company"), source: "manual" })
      .returning({ id: companies.id });
    return row!.id;
  });

export const tag = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(userTags)
      .values({ name: env.id("tag") })
      .returning({ id: userTags.id });
    return row!.id;
  });

export const tagged = (
  env: ContractEnv,
  workspaceId: string,
  principalId: string,
  tagId: string,
) =>
  env.scoped(workspaceId, (db) =>
    db
      .insert(userTagAssignments)
      .values({ principalId: principalId as never, tagId: tagId as never }),
  );

/** Matches every identified customer with an example.test address. */
export const exampleRules = {
  match: "all" as const,
  conditions: [
    {
      attribute: "email" as const,
      operator: "ends_with" as const,
      value: "@example.test",
    },
  ],
};

export const segment = (
  env: ContractEnv,
  workspaceId: string,
  type: "manual" | "dynamic" = "manual",
) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(segments)
      .values({
        name: "Contract",
        slug: env.id("segment").replaceAll("_", "-"),
        type,
        rules: type === "dynamic" ? exampleRules : null,
      })
      .returning({ id: segments.id });
    return row!.id;
  });

export const member = (
  env: ContractEnv,
  workspaceId: string,
  segmentId: string,
  principalId: string,
) =>
  env.scoped(workspaceId, (db) =>
    db.insert(userSegments).values({
      segmentId: segmentId as never,
      principalId: principalId as never,
    }),
  );
