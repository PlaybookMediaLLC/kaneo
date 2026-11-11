import { eq, inArray } from "drizzle-orm";
import type { BoardId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { principal } from "../../database/quills/schema/auth";
import { boardProjects } from "../../database/quills/schema/platform-links";
import type { ContractEnv } from "../framework/contract";

// Request and seed helpers for the feedback feature tests. Not fixtures themselves.

type App = {
  request: (path: string, init: RequestInit) => Response | Promise<Response>;
};

/** Sends one request to workspace A as `user`. */
export async function call(
  app: App,
  env: ContractEnv,
  user: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await app.request(`/quills/${env.a}${path}`, {
    method,
    headers: {
      "x-test-user": user,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const users: string[] = [];

/** A member of A who can open only the listed projects. */
export async function restrictedMember(
  env: ContractEnv,
  projectIds: string[],
  role = "member",
) {
  const id = env.id("restricted");
  users.push(id);
  await env.db
    .insert(kaneo.userTable)
    .values({ id, name: id, email: `${id}@example.test` });
  await env.db.insert(kaneo.workspaceUserTable).values({
    workspaceId: env.a,
    userId: id,
    role,
    joinedAt: new Date(),
  });
  await env.db.insert(kaneo.workspaceMemberAccessTable).values({
    workspaceId: env.a,
    userId: id,
    projectAccess: "selected",
  });
  if (projectIds.length)
    await env.db.insert(kaneo.workspaceMemberProjectTable).values(
      projectIds.map((projectId) => ({
        workspaceId: env.a,
        userId: id,
        projectId,
      })),
    );
  return id;
}

export const removeMembers = (env: ContractEnv) =>
  users.length
    ? env.db.delete(kaneo.userTable).where(inArray(kaneo.userTable.id, users))
    : undefined;

/** A project in A whose board links make that board private to the project's members. */
export async function linkedProject(env: ContractEnv, boardId: BoardId) {
  const projectId = env.id("project");
  await env.db.insert(kaneo.projectTable).values({
    id: projectId,
    workspaceId: env.a,
    name: "Private",
    slug: projectId,
  });
  await env.scoped(env.a, (db) =>
    db.insert(boardProjects).values({ boardId, projectId }),
  );
  return projectId;
}

/** The test customer of A's owner. A teammate has at most one. */
export const testCustomer = (env: ContractEnv) =>
  env.scoped(env.a, async (db, actor) => {
    await db
      .insert(principal)
      .values({
        type: "user",
        role: "user",
        displayName: "Test customer",
        testOwnerPrincipalId: actor.principalId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    const [row] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.testOwnerPrincipalId, actor.principalId));
    return row!.id;
  });

/** A plain customer principal of A, for votes. */
export const customer = (env: ContractEnv) =>
  env.scoped(env.a, async (db) => {
    const [row] = await db
      .insert(principal)
      .values({ type: "user", role: "user", createdAt: new Date() })
      .returning({ id: principal.id });
    return row!.id;
  });
