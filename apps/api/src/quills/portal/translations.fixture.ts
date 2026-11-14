import { eq } from "drizzle-orm";
import { posts } from "../../database/quills/schema/posts";
import { fixture } from "../framework/contract";
import { aiScene, hiddenOf } from "./feedback/ai.fixture";
import { probe, type Scene } from "./feedback/seed.fixture";

export const translateQuillsPortalContent = fixture<Scene>({
  seed: aiScene,
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
