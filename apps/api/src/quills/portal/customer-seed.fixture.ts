import { and, eq } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import { settings } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import * as kaneo from "../../database/schema";
import { hashToken } from "../framework/audience";
import type { ContractEnv } from "../framework/contract";

// Seed helpers for the P3c portal fixtures and tests. Not fixtures themselves.

/** Turns the portal on (public visibility) in a workspace. */
export const enablePortal = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, (db) =>
    db
      .update(settings)
      .set({ portalConfig: JSON.stringify({ enabled: true }) }),
  );

/** A published post on a board that customers can see. */
export const customerPost = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Contract", slug: env.id("board") })
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .limit(1);
    const title = env.id("post");
    const [post] = await db
      .insert(posts)
      .values({
        title,
        content: "Contract",
        boardId: board!.id,
        principalId: actor.principalId,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    return { postId: post!.id, title };
  });

/** The invited address of a Kaneo account in the contract (its email). */
export const accountEmail = (userId: string) => `${userId}@example.test`;

/** Marks a contract account's email as verified, as a real sign-in would. */
export const verifyEmail = (env: ContractEnv, userId: string) =>
  env.db
    .update(kaneo.userTable)
    .set({ emailVerified: true })
    .where(eq(kaneo.userTable.id, userId));

/**
 * A pending invite for `email` with a known token. An earlier pending invite for the address is
 * canceled first, so the one-pending-invite rule never blocks a new seed.
 */
export const pendingInvite = (
  env: ContractEnv,
  workspaceId: string,
  email = `${env.id("invitee")}@example.test`,
) =>
  env.scoped(workspaceId, async (db, actor) => {
    await db
      .update(portalInvites)
      .set({ status: "canceled", tokenHashes: [] })
      .where(
        and(
          eq(portalInvites.email, email),
          eq(portalInvites.status, "pending"),
        ),
      );
    const token = env.id("invite_token_with_enough_length");
    const [row] = await db
      .insert(portalInvites)
      .values({
        email,
        invitedByPrincipalId: actor.principalId as PrincipalId,
        tokenHashes: [hashToken(token)],
        expiresAt: new Date(Date.now() + 86_400_000),
        lastSentAt: new Date(),
      })
      .returning({ id: portalInvites.id });
    return { inviteId: row!.id, token, email };
  });
