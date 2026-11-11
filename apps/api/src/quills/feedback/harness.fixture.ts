import { resolve } from "node:path";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../../database/quills/client";
import { runQuillsMigrations } from "../../database/quills/migrate";
import * as kaneo from "../../database/schema";
import { contractApp } from "../framework/contract";
import quillsRouter from "../index";

/**
 * Feature-test world on a disposable local quills_ database. Workspace A has an owner,
 * a member who can open only the open project, and an open and a private project.
 * Workspace B has its own owner.
 */
export async function startFeature(pool: Pool, url: string, name: string) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/quills_")
  )
    throw new Error("Use a disposable local quills_ database");
  const db = drizzle(pool, { schema: kaneo });
  await migrate(drizzle(pool), { migrationsFolder: resolve("drizzle") });
  await runQuillsMigrations(url, resolve("drizzle/quills"));
  const p = `${name}_${Date.now().toString(36)}`;
  const a = `${p}_a`,
    b = `${p}_b`;
  const users = {
    owner: `${p}_owner`,
    member: `${p}_member`,
    outsider: `${p}_outsider`,
  };
  const projects = { open: `${p}_open`, hidden: `${p}_hidden` };
  await db.insert(kaneo.userTable).values(
    Object.values(users).map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
    })),
  );
  await db
    .insert(kaneo.workspaceTable)
    .values(
      [a, b].map((id) => ({ id, name: id, slug: id, createdAt: new Date() })),
    );
  // Every Quills action, so only project visibility can deny the member.
  const role = `${p}_all`;
  await db.insert(kaneo.workspaceRoleTable).values({
    workspaceId: a,
    role,
    permission: JSON.stringify({
      workspace: ["read"],
      project: ["read"],
      quills: ["read", "create", "update", "delete", "manage_settings"],
    }),
    createdAt: new Date(),
  });
  await db.insert(kaneo.workspaceUserTable).values([
    {
      workspaceId: a,
      userId: users.owner,
      role: "owner",
      joinedAt: new Date(),
    },
    {
      workspaceId: a,
      userId: users.member,
      role,
      joinedAt: new Date(),
    },
    {
      workspaceId: b,
      userId: users.outsider,
      role: "owner",
      joinedAt: new Date(),
    },
  ]);
  await db.insert(kaneo.projectTable).values(
    Object.values(projects).map((id) => ({
      id,
      workspaceId: a,
      name: id,
      slug: id,
    })),
  );
  await db.insert(kaneo.workspaceMemberAccessTable).values({
    workspaceId: a,
    userId: users.member,
    projectAccess: "selected",
  });
  await db.insert(kaneo.workspaceMemberProjectTable).values({
    workspaceId: a,
    userId: users.member,
    projectId: projects.open,
  });
  const taskId = `${p}_task`;
  await db
    .insert(kaneo.taskTable)
    .values({ id: taskId, projectId: projects.open, title: "Task", number: 1 });
  const app = contractApp(quillsRouter);
  const request = async (
    user: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await app.request(`/quills/${a}${path}`, {
      method,
      headers: {
        "x-test-user": user,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const scoped = <T>(
    workspaceId: string,
    userId: string,
    work: (db: Database, actor: QuillsActor) => Promise<T>,
  ) => withQuillsWorkspace({ workspaceId, userId }, work);
  const stop = async () => {
    await pool.query(
      "DELETE FROM public.workspace WHERE id = ANY($1::text[])",
      [[a, b]],
    );
    await db
      .delete(kaneo.userTable)
      .where(inArray(kaneo.userTable.id, Object.values(users)));
    await pool.end();
  };
  return { a, b, users, projects, taskId, db, request, scoped, stop };
}
