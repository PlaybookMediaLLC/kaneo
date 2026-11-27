import {
  initializeQuillsWorkspace,
  markQuillsWorkspaceInitialized,
} from "./initialize-workspace";
import { supportsHnswIterativeScan } from "../../quills/assistant/engine/distance";
import { CATALOGUE_VERSION } from "./seed-system";
import { eq, sql, type SQL } from "drizzle-orm";
import { hasInstanceAdminRole } from "../../utils/instance-admin-role";
import {
  drizzle,
  NodePgTransaction,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { getDatabasePool } from "../index";
import * as schema from "./schema";

type Transaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];
declare const workspaceScope: unique symbol;
export type Database = Transaction & { readonly [workspaceScope]: true };

// Pre-extract the ~90-table relational schema metadata and PgDialect once at module load
// instead of rebuilding them on every scoped Quills transaction.
const quillsDialect = new PgDialect();
const schemaTemplate = drizzle({} as never, { schema });
const quillsSchemaConfig = {
  fullSchema: schemaTemplate._.fullSchema,
  schema: schemaTemplate._.schema!,
  tableNamesMap: schemaTemplate._.tableNamesMap,
};

async function scopedTransaction<T>(
  work: (tx: Transaction) => Promise<T>,
  snapshot = false,
): Promise<T> {
  const client = await getDatabasePool().connect();
  let active = true;
  // Retained transactions and lazy query builders must never reuse a released client.
  const guarded = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (!active) throw new Error("Quills transaction has ended");
        return Reflect.apply(value, target, args);
      };
    },
  });
  try {
    return await drizzle(client).transaction(
      async () => {
        const session = drizzle(guarded)._.session;
        const tx = new NodePgTransaction<
          typeof schema,
          NonNullable<typeof schemaTemplate._.schema>
        >(quillsDialect, session, quillsSchemaConfig);
        try {
          return await work(tx);
        } finally {
          // Finalization uses the private client; caller queries close before COMMIT.
          active = false;
        }
      },
      { isolationLevel: snapshot ? "repeatable read" : "read committed" },
    );
  } finally {
    active = false;
    client.release();
  }
}

export type QuillsActor = {
  principalId: typeof schema.principal.$inferSelect.id;
  userId: string;
  workspaceId: string;
};

export async function withQuillsWorkspace<T>(
  context: { workspaceId: string; userId: string },
  work: (db: Database, actor: QuillsActor) => Promise<T>,
  options: {
    exclusiveWorkspace?: boolean;
    snapshot?: boolean;
    readOnly?: boolean;
  } = {},
): Promise<T> {
  if (!context.workspaceId || !context.userId)
    throw new Error("Workspace and user are required");
  return scopedTransaction(async (tx) => {
    let identity: {
      name: string;
      slug: string;
      userName: string;
      image: string | null;
      role: string | null;
    };
    if (options.readOnly && !options.exclusiveWorkspace) {
      // Read-only routes skip FOR SHARE row locks (matching withQuillsAudience) and check
      // workspace, user, and membership in one round-trip.
      const res = await tx.execute<{
        name: string;
        slug: string;
        userName: string;
        image: string | null;
        role: string | null;
        memberId: string | null;
      }>(sql`
        SELECT w.name, w.slug, u.name AS "userName", u.image, u.role, m.id AS "memberId"
        FROM public.workspace w
        JOIN public."user" u ON u.id = ${context.userId}
        LEFT JOIN public.workspace_member m
          ON m.workspace_id = w.id AND m.user_id = u.id
        WHERE w.id = ${context.workspaceId} AND w.archived_at IS NULL
        LIMIT 1
      `);
      if (res.rows.length !== 1)
        throw new Error("Quills workspace access denied");
      const row = res.rows[0]!;
      if (!row.memberId && !hasInstanceAdminRole(row.role))
        throw new Error("Quills workspace access denied");
      identity = row;
    } else {
      const workspace = await tx.execute<{
        name: string;
        slug: string;
        userName: string;
        image: string | null;
        role: string | null;
      }>(sql`
        SELECT w.name, w.slug, u.name AS "userName", u.image, u.role
        FROM public.workspace w, public."user" u
        WHERE w.id = ${context.workspaceId} AND u.id = ${context.userId}
        AND w.archived_at IS NULL ${options.exclusiveWorkspace ? sql`FOR UPDATE OF w` : sql`FOR SHARE OF w, u`}
      `);
      if (workspace.rows.length !== 1)
        throw new Error("Quills workspace access denied");
      const membership = await tx.execute(sql`
        SELECT id FROM public.workspace_member
        WHERE workspace_id = ${context.workspaceId} AND user_id = ${context.userId} FOR SHARE
      `);
      identity = workspace.rows[0]!;
      if (membership.rows.length !== 1 && !hasInstanceAdminRole(identity.role))
        throw new Error("Quills workspace access denied");
    }
    await tx.execute(
      supportsHnswIterativeScan()
        ? sql`select set_config('quills.workspace_id', ${context.workspaceId}, true), set_config('pg_trgm.word_similarity_threshold', '0.4', true), set_config('hnsw.iterative_scan', 'strict_order', true)`
        : sql`select set_config('quills.workspace_id', ${context.workspaceId}, true), set_config('pg_trgm.word_similarity_threshold', '0.4', true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE quills_runtime`);
    const initializedWorkspace = {
      workspaceId: context.workspaceId,
      name: identity.name,
      slug: identity.slug,
    };
    const wroteInit = await initializeQuillsWorkspace(
      tx as Database,
      initializedWorkspace,
    );
    let actor = (
      await tx
        .select({ id: schema.principal.id })
        .from(schema.principal)
        .where(eq(schema.principal.kaneoUserId, context.userId))
    )[0];
    if (!actor) {
      await tx
        .insert(schema.principal)
        .values({
          kaneoUserId: context.userId,
          type: "user",
          role: "user",
          displayName: identity.userName,
          avatarUrl: identity.image,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      actor = (
        await tx
          .select({ id: schema.principal.id })
          .from(schema.principal)
          .where(eq(schema.principal.kaneoUserId, context.userId))
      )[0];
    }
    if (!actor) throw new Error("Quills actor could not be initialized");
    const result = await work(tx as Database, {
      principalId: actor.id,
      userId: context.userId,
      workspaceId: context.workspaceId,
    });
    return { result, markInit: wroteInit ? initializedWorkspace : null };
  }, options.snapshot).then(({ result, markInit }) => {
    if (markInit) markQuillsWorkspaceInitialized(markInit);
    return result;
  });
}

/** The workspace a portal, widget or public caller named does not exist or is archived. */
export class QuillsWorkspaceUnavailable extends Error {
  constructor() {
    super("Quills workspace is unavailable");
  }
}

/**
 * Trusted entry point for portal, widget and public requests. Its only caller is
 * src/quills/framework/define-route.ts, through the audience resolvers in framework/audience.ts.
 *
 * Caller model: `workspace` is an ID or slug that the caller names; an ID match wins. The caller
 * is not a workspace member, so this function authorizes only "the workspace exists and is not
 * archived". It never reads or writes workspace_member and never creates a teammate principal.
 * `kaneoUserId` is the signed-in Kaneo account from the session, never from request input. It
 * lets the customer_membership trigger accept a new customer profile linked to that one account.
 * Audience and ownership rules belong to the resolver and the handler.
 *
 * A workspace that never initialized Quills (no teammate has used it) is unavailable here, so an
 * anonymous caller cannot seed one. `lock` holds the workspace row for a write; reads skip it.
 */
export async function withQuillsAudience<T>(
  context: { workspace: string; kaneoUserId?: string; lock?: boolean },
  work: (
    db: Database,
    workspace: { id: string; name: string; slug: string },
  ) => Promise<T>,
): Promise<T> {
  if (!context.workspace) throw new QuillsWorkspaceUnavailable();
  return audienceTransaction(namedWorkspace(context.workspace), context, work);
}

/** Where a signed caller's credential lives. framework/signed.ts documents each kind. */
export type SignedScope = { integration: string } | { workspace: string };

/**
 * Trusted entry point for signed machine callers. Its only caller is
 * src/quills/framework/define-route.ts (routes with `audience: "signed"`), after a verifier in
 * src/quills/framework/signed.ts located the credential.
 *
 * Caller model: a machine (a provider webhook, the mail provider, an OAuth redirect) with no
 * session, no customer principal and no teammate principal. The workspace comes from the
 * credential, never from a body, query or path copy of a workspace:
 * - `{ integration }` (a UUID): the workspace of that integrations row, read by the security-definer
 *   function quills.integration_workspace, which only the application credential may execute.
 *   The verifier then reads the row's secret under that workspace's RLS and checks the signature.
 * - `{ workspace }` (an ID or slug): named by a credential that the verifier already checked before
 *   any database access, for example an instance-signed OAuth state or the mail provider signature
 *   over the receiving address.
 * Like withQuillsAudience, it authorizes nothing else, never reads workspace_member and rejects a
 * missing, archived or uninitialized workspace. It always locks the workspace row: signed routes write.
 */
export async function withQuillsSigned<T>(
  scope: SignedScope,
  work: (
    db: Database,
    workspace: { id: string; name: string; slug: string },
  ) => Promise<T>,
): Promise<T> {
  const lookup =
    "integration" in scope
      ? {
          where: sql`id = quills.integration_workspace(${scope.integration}::uuid)`,
        }
      : scope.workspace
        ? namedWorkspace(scope.workspace)
        : undefined;
  if (!lookup) throw new QuillsWorkspaceUnavailable();
  return audienceTransaction(lookup, { lock: true }, work);
}

/** An ID or a slug; an ID match wins. */
const namedWorkspace = (workspace: string) => ({
  where: sql`(id = ${workspace} OR slug = ${workspace})`,
  order: sql`ORDER BY id = ${workspace} DESC`,
});

async function audienceTransaction<T>(
  lookup: { where: SQL; order?: SQL },
  context: { kaneoUserId?: string; lock?: boolean },
  work: (
    db: Database,
    workspace: { id: string; name: string; slug: string },
  ) => Promise<T>,
): Promise<T> {
  return scopedTransaction(async (tx) => {
    const result = await tx.execute<{ id: string; name: string; slug: string }>(
      sql`SELECT id, name, slug FROM public.workspace
          WHERE archived_at IS NULL AND ${lookup.where} ${lookup.order ?? sql``} LIMIT 1 ${context.lock ? sql`FOR SHARE` : sql``}`,
    );
    const workspace = result.rows[0];
    if (!workspace) throw new QuillsWorkspaceUnavailable();
    await tx.execute(
      supportsHnswIterativeScan()
        ? sql`select set_config('quills.workspace_id', ${workspace.id}, true), set_config('quills.customer_user_id', ${context.kaneoUserId ?? ""}, true), set_config('pg_trgm.word_similarity_threshold', '0.4', true), set_config('hnsw.iterative_scan', 'strict_order', true)`
        : sql`select set_config('quills.workspace_id', ${workspace.id}, true), set_config('quills.customer_user_id', ${context.kaneoUserId ?? ""}, true), set_config('pg_trgm.word_similarity_threshold', '0.4', true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE quills_runtime`);
    const [initialized] = await tx
      .select({
        id: schema.settings.id,
        name: schema.settings.name,
        slug: schema.settings.slug,
        version: schema.settings.catalogueVersion,
      })
      .from(schema.settings)
      .limit(1);
    if (!initialized) throw new QuillsWorkspaceUnavailable();
    if (initialized.version !== CATALOGUE_VERSION) {
      await initializeQuillsWorkspace(tx as Database, {
        workspaceId: workspace.id,
        ...workspace,
      });
    } else if (
      initialized.name !== workspace.name ||
      initialized.slug !== workspace.slug
    ) {
      await tx
        .update(schema.settings)
        .set({ name: workspace.name, slug: workspace.slug });
    }
    return work(tx as Database, workspace);
  });
}

/** Trusted maintenance entry point; request handlers must use withQuillsWorkspace. */
export async function withQuillsSystemWorkspace<T>(
  workspaceId: string,
  work: (db: Database) => Promise<T>,
  options: { allowArchived?: boolean; snapshot?: boolean } = {},
): Promise<T> {
  if (!workspaceId) throw new Error("Workspace is required");
  return scopedTransaction(async (tx) => {
    const result = await tx.execute<{ id: string; name: string; slug: string }>(
      sql`SELECT id, name, slug FROM public.workspace WHERE id = ${workspaceId} AND (${options.allowArchived === true} OR archived_at IS NULL) FOR SHARE`,
    );
    if (result.rows.length !== 1)
      throw new Error("Quills workspace is unavailable");
    await tx.execute(
      supportsHnswIterativeScan()
        ? sql`select set_config('quills.workspace_id', ${workspaceId}, true), set_config('pg_trgm.word_similarity_threshold', '0.4', true), set_config('hnsw.iterative_scan', 'strict_order', true)`
        : sql`select set_config('quills.workspace_id', ${workspaceId}, true), set_config('pg_trgm.word_similarity_threshold', '0.4', true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE quills_runtime`);
    const initializedWorkspace = {
      workspaceId,
      ...result.rows[0]!,
    };
    const wroteInit =
      !options.allowArchived &&
      (await initializeQuillsWorkspace(tx as Database, initializedWorkspace));
    const value = await work(tx as Database);
    return { value, markInit: wroteInit ? initializedWorkspace : null };
  }, options.snapshot).then(({ value, markInit }) => {
    if (markInit) markQuillsWorkspaceInitialized(markInit);
    return value;
  });
}
