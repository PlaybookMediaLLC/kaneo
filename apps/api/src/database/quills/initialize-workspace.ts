import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { settings } from "./schema/auth";
import { seedSystemData, CATALOGUE_VERSION } from "./seed-system";

const INIT_CACHE_TTL_MS = 5 * 60_000;
const INIT_CACHE_MAX = 2_000;
const initializedWorkspaces = new Map<
  string,
  { name: string; slug: string; at: number }
>();

/** Clears the in-process initialization memo after a wipe, transfer, or test reset. */
export function invalidateQuillsWorkspaceInitCache(workspaceId?: string): void {
  if (workspaceId) initializedWorkspaces.delete(workspaceId);
  else initializedWorkspaces.clear();
}

/** Records a workspace as initialized after its transaction has committed. */
export function markQuillsWorkspaceInitialized(workspace: {
  workspaceId: string;
  name: string;
  slug: string;
}): void {
  if (initializedWorkspaces.size >= INIT_CACHE_MAX)
    initializedWorkspaces.clear();
  initializedWorkspaces.set(workspace.workspaceId, {
    name: workspace.name,
    slug: workspace.slug,
    at: Date.now(),
  });
}

/**
 * Ensures the workspace's Quills settings and system catalogue exist.
 * Returns `true` when this transaction wrote initialization/sync rows so the caller marks
 * `initializedWorkspaces` only after commit (avoiding cache poisoning on rollback).
 */
export async function initializeQuillsWorkspace(
  db: Database,
  workspace: { workspaceId: string; name: string; slug: string },
): Promise<boolean> {
  const cached = initializedWorkspaces.get(workspace.workspaceId);
  if (
    cached &&
    Date.now() - cached.at < INIT_CACHE_TTL_MS &&
    cached.name === workspace.name &&
    cached.slug === workspace.slug
  ) {
    return false;
  }
  const existing = (
    await db
      .select({
        id: settings.id,
        name: settings.name,
        slug: settings.slug,
        version: settings.catalogueVersion,
      })
      .from(settings)
      .limit(1)
  )[0];
  if (existing?.version === CATALOGUE_VERSION) {
    if (existing.name !== workspace.name || existing.slug !== workspace.slug) {
      await db
        .update(settings)
        .set({ name: workspace.name, slug: workspace.slug });
      return true;
    }
    // Already committed with matching catalogue version, name, and slug: safe to cache now.
    markQuillsWorkspaceInitialized(workspace);
    return false;
  }
  await db.execute(
    sql`select pg_advisory_xact_lock(48204, hashtext(${workspace.workspaceId}))`,
  );
  const current = (
    await db
      .select({ version: settings.catalogueVersion })
      .from(settings)
      .limit(1)
  )[0];
  if (current && current.version > CATALOGUE_VERSION)
    throw new Error("Quills catalogue is newer than this application");
  if (current?.version === CATALOGUE_VERSION) return false;
  await seedSystemData(db);
  if (current) {
    await db.update(settings).set({ catalogueVersion: CATALOGUE_VERSION });
  } else {
    await db.insert(settings).values({
      catalogueVersion: CATALOGUE_VERSION,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: new Date(),
    });
  }
  return true;
}
