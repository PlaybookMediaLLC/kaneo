import { asc, eq } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import {
  changelogReactions,
  changelogReads,
} from "../../database/quills/schema/changelog-engagement";
import { fixture, type ContractEnv, type Fixture } from "../framework/contract";
import { scene, type Scene } from "./feedback/seed.fixture";
import { title, type Customer } from "./feedback/viewer";

// Contract fixtures for the changelog engagement routes of both audiences.

const hidden = (s: Scene) => [
  ...s.a.hidden,
  ...s.b.hidden,
  s.b.postTitle,
  s.b.postId,
];

/** The caller's reactions and read mark in A. */
const probe = (env: ContractEnv, s: Scene) =>
  env.scoped(env.a, async (db) => {
    const me = s.me.principalId as PrincipalId;
    return {
      reactions: await db
        .select({
          entryId: changelogReactions.changelogEntryId,
          emoji: changelogReactions.emoji,
        })
        .from(changelogReactions)
        .where(eq(changelogReactions.principalId, me))
        .orderBy(
          asc(changelogReactions.changelogEntryId),
          asc(changelogReactions.emoji),
        ),
      reads: await db
        .select({ at: changelogReads.lastReadAt })
        .from(changelogReads)
        .where(eq(changelogReads.principalId, me)),
    };
  });

const make = (
  who: Customer,
  valid: (s: Scene) => object,
  foreign?: (s: Scene) => Record<string, string>,
) =>
  fixture<Scene>({
    seed: (env) => scene(env, who),
    valid: (s) => ({ ...valid(s), ...(s.token && { bearer: s.token }) }),
    foreign,
    hidden,
    own: (s) => s.a.own,
    probe,
  });

function engagement(who: Customer): Record<string, Fixture> {
  const t = title(who);
  return {
    [`setQuills${t}ChangelogReaction`]: make(
      who,
      (s) => ({
        params: { entryId: s.a.entryId },
        body: { emoji: "🎉", reacted: true },
      }),
      (s) => ({ entryId: s.b.entryId }),
    ),
    [`markQuills${t}ChangelogRead`]: make(who, () => ({})),
    [`getQuills${t}ChangelogUnread`]: make(who, () => ({})),
  };
}

const portal = engagement("portal");
const widget = engagement("widget");
export const setQuillsPortalChangelogReaction =
  portal.setQuillsPortalChangelogReaction!;
export const markQuillsPortalChangelogRead =
  portal.markQuillsPortalChangelogRead!;
export const getQuillsPortalChangelogUnread =
  portal.getQuillsPortalChangelogUnread!;
export const setQuillsWidgetChangelogReaction =
  widget.setQuillsWidgetChangelogReaction!;
export const markQuillsWidgetChangelogRead =
  widget.markQuillsWidgetChangelogRead!;
export const getQuillsWidgetChangelogUnread =
  widget.getQuillsWidgetChangelogUnread!;
