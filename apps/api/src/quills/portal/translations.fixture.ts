import { eq } from "drizzle-orm";
import { posts } from "../../database/quills/schema/posts";
import { fixture } from "../framework/contract";
// Installs the answers of the portal AI prompts.
import { hiddenOf } from "./feedback/ai.fixture";
import { probe, scene, type Scene } from "./feedback/seed.fixture";

export const translateQuillsPortalContent = fixture<Scene>({
  seed: (env) => scene(env, "portal"),
  valid: (s) => ({ body: { postId: s.a.postId, locale: "de" } }),
  foreign: (s) => ({ postId: s.b.postId }),
  hidden: hiddenOf,
  own: (s) => s.a.own,
  probe,
  softDelete: (env, s) =>
    env.scoped(env.a, (db) =>
      db
        .update(posts)
        .set({ deletedAt: new Date() })
        .where(eq(posts.id, s.a.postId as never)),
    ),
});
