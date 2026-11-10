import { teamMemberTable, teamTable } from "../database/schema";
import { eq } from "drizzle-orm";
import { teams } from "../database/quills/schema/teams";
import { fixture, type ContractEnv } from "./framework/contract";

/** A Kaneo team and an unbound Quills team in one workspace. */
async function side(env: ContractEnv, workspaceId: string) {
  const kaneoTeamId = env.id("team");
  await env.db.insert(teamTable).values({
    id: kaneoTeamId,
    name: "Contract",
    workspaceId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [team] = await env.scoped(workspaceId, (db) =>
    db.insert(teams).values({ name: "Contract" }).returning({ id: teams.id }),
  );
  return { kaneoTeamId, teamId: team!.id };
}
const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;

export const bindQuillsTeam = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: { kaneoTeamId: a.kaneoTeamId, isDefault: false },
  }),
  foreign: ({ b }: Ids) => ({ kaneoTeamId: b.kaneoTeamId }),
});

export const updateQuillsTeamBinding = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { teamId: a.teamId },
    body: { kaneoTeamId: a.kaneoTeamId },
  }),
  foreign: ({ b }: Ids) => ({ teamId: b.teamId, kaneoTeamId: b.kaneoTeamId }),
});

export const listQuillsTeams = fixture({
  // A bound team, so the projected roster has a member to list.
  seed: async (env) => {
    const { kaneoTeamId, teamId } = await side(env, env.a);
    await env.db.insert(teamMemberTable).values({
      id: env.id("member"),
      teamId: kaneoTeamId,
      userId: env.owner,
      createdAt: new Date(),
    });
    await env.scoped(env.a, (db) =>
      db.update(teams).set({ kaneoTeamId }).where(eq(teams.id, teamId)),
    );
  },
  valid: () => ({}),
});
