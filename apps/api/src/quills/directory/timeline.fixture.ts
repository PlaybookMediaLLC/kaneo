import { principal, user } from "../../database/quills/schema/auth";
import { fixture, type ContractEnv } from "../framework/contract";

async function seedPerson(env: ContractEnv) {
  const make = (ws: string, tag: string) =>
    env.scoped(ws, async (db) => {
      const [u] = await db
        .insert(user)
        .values({ name: `Timeline ${tag}`, email: `tl-${tag}@example.test` })
        .returning({ id: user.id });
      const [p] = await db
        .insert(principal)
        .values({
          userId: u!.id,
          role: "user",
          type: "user",
          displayName: `Timeline ${tag}`,
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      return p!.id;
    });
  return {
    a: await make(env.a, env.id("a")),
    b: await make(env.b, env.id("b")),
  };
}

export const getQuillsUserTimeline = fixture({
  seed: seedPerson,
  valid: (ids) => ({ params: { principalId: ids.a } }),
  foreign: (ids) => ({ principalId: ids.b }),
});
