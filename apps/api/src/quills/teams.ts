import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../openapi";
import { teams, teamMembers } from "../database/quills/schema/teams";
import { defineQuillsRoute } from "./framework/define-route";
import { canonicalTeam } from "./framework/platform-reads";

const team = z.object({
  id: z.string(),
  name: z.string(),
  kaneoTeamId: z.string().nullable(),
  isDefault: z.boolean(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  description: z.string().nullable(),
  assignmentMethod: z.string(),
});
const teamFields = {
  id: teams.id,
  name: teams.name,
  kaneoTeamId: teams.kaneoTeamId,
  isDefault: teams.isDefault,
  icon: teams.icon,
  color: teams.color,
  description: teams.description,
  assignmentMethod: teams.assignmentMethod,
};
const errors = { 404: "Team not found" };

const bindTeam = defineQuillsRoute({
  method: "post",
  path: "/teams",
  operationId: "bindQuillsTeam",
  summary: "Bind a workspace team to Quills",
  action: "manage_settings",
  body: z.object({
    kaneoTeamId: z.string().min(1).max(200),
    isDefault: z.boolean().default(false),
  }),
  response: team,
  responseDescription: "Team",
  errors,
  load: ({ body, workspaceId }) => canonicalTeam(workspaceId, body.kaneoTeamId),
  event: ({ body }, result) => ({
    type: "team.bound",
    entityType: "team",
    entityId: result.id,
    payload: { kaneoTeamId: body.kaneoTeamId },
  }),
  handler: async ({ db, body, loaded: canonical }) => {
    await db.execute(sql`SELECT id FROM quills.settings FOR UPDATE`);
    if (body.isDefault)
      await db
        .update(teams)
        .set({ isDefault: false })
        .where(eq(teams.isDefault, true));
    const [row] = await db
      .insert(teams)
      .values({
        name: canonical.name,
        kaneoTeamId: canonical.id,
        isDefault: body.isDefault,
      })
      .onConflictDoUpdate({
        target: [teams.workspaceId, teams.kaneoTeamId],
        set: { isDefault: body.isDefault, deletedAt: null },
      })
      .returning(teamFields);
    return row!;
  },
});

const updateBinding = defineQuillsRoute({
  method: "put",
  path: "/teams/{teamId}/binding",
  operationId: "updateQuillsTeamBinding",
  summary: "Change the team binding of a Quills team",
  action: "manage_settings",
  params: z.object({ teamId: flexibleToTypeIdSchema("team") }),
  body: z.object({
    kaneoTeamId: z.string().min(1).max(200).nullable(),
    isDefault: z.boolean().optional(),
  }),
  response: team,
  responseDescription: "Team",
  errors,
  load: async ({ body, workspaceId }) => {
    if (body.kaneoTeamId) await canonicalTeam(workspaceId, body.kaneoTeamId);
  },
  event: ({ params, body: { kaneoTeamId } }) =>
    kaneoTeamId
      ? {
          type: "team.bound",
          entityType: "team",
          entityId: params.teamId,
          payload: { kaneoTeamId },
        }
      : { type: "team.unbound", entityType: "team", entityId: params.teamId },
  handler: async ({ db, params, body }) => {
    await db.execute(sql`SELECT id FROM quills.settings FOR UPDATE`);
    if (body.isDefault)
      await db
        .update(teams)
        .set({ isDefault: false })
        .where(eq(teams.isDefault, true));
    const [row] = await db
      .update(teams)
      .set({ kaneoTeamId: body.kaneoTeamId, isDefault: body.isDefault })
      .where(and(eq(teams.id, params.teamId), isNull(teams.deletedAt)))
      .returning(teamFields);
    if (!row)
      throw new HTTPException(404, { message: "Quills team not found" });
    return row;
  },
});

const teamParams = z.object({ teamId: flexibleToTypeIdSchema("team") });

// The name and roster of a bound team belong to Kaneo; only Quills fields change here.
const updateTeam = defineQuillsRoute({
  method: "put",
  path: "/teams/{teamId}",
  operationId: "updateQuillsTeam",
  summary: "Update the Quills settings of a team",
  action: "manage_settings",
  params: teamParams,
  body: z
    .object({
      icon: z.string().max(16).nullable().optional(),
      color: z.string().max(32).nullable().optional(),
      description: z.string().max(500).nullable().optional(),
      assignmentMethod: z
        .enum(["manual", "round_robin", "balanced"])
        .optional(),
    })
    .refine((b) => Object.keys(b).length > 0, "Send at least one field"),
  response: team,
  responseDescription: "Team",
  errors,
  event: ({ params }) => ({
    type: "team.updated",
    entityType: "team",
    entityId: params.teamId,
  }),
  handler: async ({ db, params, body }) => {
    const [row] = await db
      .update(teams)
      .set({
        icon: body.icon,
        color: body.color,
        description: body.description,
        assignmentMethod: body.assignmentMethod,
      })
      .where(and(eq(teams.id, params.teamId), isNull(teams.deletedAt)))
      .returning(teamFields);
    if (!row)
      throw new HTTPException(404, { message: "Quills team not found" });
    return row;
  },
});

const deleteTeam = defineQuillsRoute({
  method: "delete",
  path: "/teams/{teamId}",
  operationId: "deleteQuillsTeam",
  summary: "Delete a Quills team",
  description: "Soft delete. The Kaneo team and its members stay.",
  action: "manage_settings",
  params: teamParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted team",
  errors,
  event: ({ params }) => ({
    type: "team.deleted",
    entityType: "team",
    entityId: params.teamId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(teams)
      .set({ deletedAt: new Date(), isDefault: false })
      .where(and(eq(teams.id, params.teamId), isNull(teams.deletedAt)))
      .returning({ id: teams.id });
    if (!row)
      throw new HTTPException(404, { message: "Quills team not found" });
    return row;
  },
});

const listTeams = defineQuillsRoute({
  method: "get",
  path: "/teams",
  operationId: "listQuillsTeams",
  summary: "List Quills teams and their rosters",
  action: "read",
  response: z.object({
    teams: z.array(team),
    members: z.array(z.object({ teamId: z.string(), principalId: z.string() })),
  }),
  responseDescription: "Teams and their projected rosters",
  errors,
  handler: async ({ db }) => ({
    teams: await db
      .select(teamFields)
      .from(teams)
      .where(isNull(teams.deletedAt)),
    members: await db
      .select({
        teamId: teamMembers.teamId,
        principalId: teamMembers.principalId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(isNull(teams.deletedAt)),
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...bindTeam)
  .openapi(...updateBinding)
  .openapi(...listTeams)
  .openapi(...updateTeam)
  .openapi(...deleteTeam);
