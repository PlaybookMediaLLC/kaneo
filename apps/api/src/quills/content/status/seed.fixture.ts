import { isNull } from "drizzle-orm";
import type { StatusComponentId } from "@kaneo/ids";
import { principal, user } from "../../../database/quills/schema/auth";
import {
  statusComponentGroups,
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
  statusIncidentTemplates,
  statusIncidentUpdates,
  statusSubscriptions,
} from "../../../database/quills/schema/status";
import { fixture, type ContractEnv } from "../../framework/contract";

// Seed helpers shared by the status fixtures and feature tests. Not fixtures themselves.

/** A group, two components, an open incident, a scheduled window, a template and a subscriber in one workspace. */
export const statusIn = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [group] = await db
      .insert(statusComponentGroups)
      .values({ name: "Contract" })
      .returning({ id: statusComponentGroups.id });
    const [component, other] = await db
      .insert(statusComponents)
      .values([
        { name: "API", groupId: group!.id, status: "partial_outage" },
        { name: "Web" },
      ])
      .returning({ id: statusComponents.id });
    const incident = async (
      values: Pick<typeof statusIncidents.$inferInsert, "kind" | "status">,
      componentId: StatusComponentId,
      componentStatus: "partial_outage" | "under_maintenance",
    ) => {
      const [row] = await db
        .insert(statusIncidents)
        .values({
          title: "Contract",
          createdBy: actor.principalId,
          scheduledStartAt:
            values.kind === "maintenance"
              ? new Date(Date.now() + 86400000)
              : null,
          ...values,
        })
        .returning({ id: statusIncidents.id });
      await db
        .insert(statusIncidentComponents)
        .values({ incidentId: row!.id, componentId, componentStatus });
      await db.insert(statusIncidentUpdates).values({
        incidentId: row!.id,
        status: values.status,
        body: "Contract",
        createdBy: actor.principalId,
      });
      return row!.id;
    };
    const incidentId = await incident(
      { kind: "incident", status: "investigating" },
      component!.id,
      "partial_outage",
    );
    const maintenanceId = await incident(
      { kind: "maintenance", status: "scheduled" },
      other!.id,
      "under_maintenance",
    );
    const [template] = await db
      .insert(statusIncidentTemplates)
      .values({ name: "Outage", title: "Outage", body: "Looking into it" })
      .returning({ id: statusIncidentTemplates.id });
    const email = `${env.id("subscriber")}@example.test`;
    const [identity] = await db
      .insert(user)
      .values({ name: "Subscriber", email })
      .returning({ id: user.id });
    const [person] = await db
      .insert(principal)
      .values({
        userId: identity!.id,
        displayName: "Subscriber",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    await db
      .insert(statusSubscriptions)
      .values({ principalId: person!.id, source: "admin" });
    return {
      groupId: group!.id,
      componentId: component!.id,
      otherComponentId: other!.id,
      incidentId,
      maintenanceId,
      templateId: template!.id,
      principalId: person!.id,
      email,
    };
  });

export const seed = async (env: ContractEnv) => ({
  a: await statusIn(env, env.a),
  b: await statusIn(env, env.b),
});
export type Ids = Awaited<ReturnType<typeof seed>>;

export const by = <
  K extends "componentId" | "groupId" | "incidentId" | "templateId",
>(
  key: K,
  pick: (side: Ids["a"]) => string = (side) => side[key],
  body?: object,
) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { [key]: pick(a) }, body }),
    foreign: ({ b }: Ids) => ({ [key]: pick(b) }),
  });
export const all = fixture({ seed, valid: () => ({}) });

/** Only two live components in A, so a full reorder list stays small. */
export async function twoComponents(env: ContractEnv) {
  await env.scoped(env.a, (db) =>
    db
      .update(statusComponents)
      .set({ deletedAt: new Date() })
      .where(isNull(statusComponents.deletedAt)),
  );
  const { componentId, otherComponentId } = await statusIn(env, env.a);
  return [otherComponentId, componentId];
}

/** Only one seed's group in A. */
export async function oneGroupSet(env: ContractEnv) {
  await env.scoped(env.a, (db) => db.delete(statusComponentGroups));
  const first = await statusIn(env, env.a);
  const second = await statusIn(env, env.a);
  return [second.groupId, first.groupId];
}
