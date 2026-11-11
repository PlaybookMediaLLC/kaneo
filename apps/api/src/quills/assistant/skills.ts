import { asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { agentSkills } from "../../database/quills/schema/agent-skills";
import { someField } from "../feedback/schemas";
import { uniqueConflict } from "../support/conversation-model";
import { defineQuillsRoute, type Database } from "../framework/define-route";

// Skills: named procedures an agent reads when they apply. A skill is instructions, never a tool.

const MAX_SKILLS = 100;
const params = z.object({ skillId: flexibleToTypeIdSchema("skill") });
const assignments = z.object({ agent: z.boolean(), copilot: z.boolean() });
const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  whenToUse: z.string(),
  instructions: z.string(),
  assignments,
  enabled: z.boolean(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const columns = {
  id: agentSkills.id,
  name: agentSkills.name,
  whenToUse: agentSkills.whenToUse,
  instructions: agentSkills.instructions,
  assignments: agentSkills.assignments,
  enabled: agentSkills.enabled,
  createdAt: agentSkills.createdAt,
  updatedAt: agentSkills.updatedAt,
};
const fields = {
  name: z.string().trim().min(1).max(80),
  whenToUse: z.string().trim().min(1).max(240),
  instructions: z.string().trim().min(1).max(8000),
  assignments,
  enabled: z.boolean(),
};
const errors = {
  404: "Skill not found",
  409: "Another skill has this name",
};
type Row = Omit<
  typeof agentSkills.$inferSelect,
  "workspaceId" | "createdByPrincipalId"
>;
const view = (row: Row) => ({
  ...row,
  assignments: {
    agent: row.assignments?.agent === true,
    copilot: row.assignments?.copilot === true,
  },
});
const duplicate = uniqueConflict("Another skill has this name");
async function nameTaken(db: Database, name: string, except?: string) {
  const [row] = await db
    .select({ id: agentSkills.id })
    .from(agentSkills)
    .where(sql`lower(${agentSkills.name}) = lower(${name})`);
  if (row && row.id !== except)
    throw new HTTPException(409, { message: "Another skill has this name" });
}

const listSkills = defineQuillsRoute({
  method: "get",
  path: "/assistant/skills",
  operationId: "listQuillsSkills",
  summary: "List the assistant skills",
  action: "manage_settings",
  response: z.object({ items: z.array(skillSchema) }),
  responseDescription: "The skills, by name",
  handler: async ({ db }) => ({
    items: (
      await db
        .select(columns)
        .from(agentSkills)
        .orderBy(asc(agentSkills.name))
        .limit(MAX_SKILLS)
    ).map(view),
  }),
});

const createSkill = defineQuillsRoute({
  method: "post",
  path: "/assistant/skills",
  operationId: "createQuillsSkill",
  summary: "Create an assistant skill",
  description: `Names are unique, ignoring case. A workspace has at most ${MAX_SKILLS} skills.`,
  action: "manage_settings",
  body: z.object({
    ...fields,
    assignments: assignments.default({ agent: false, copilot: true }),
    enabled: fields.enabled.default(true),
  }),
  response: skillSchema,
  responseDescription: "The new skill",
  errors: { 409: "Another skill has this name, or the limit is reached" },
  event: (_input, skill) => ({
    type: "assistant_skill.created",
    entityType: "assistant_skill",
    entityId: skill.id,
  }),
  handler: async ({ db, actor, body }) => {
    if ((await db.$count(agentSkills)) >= MAX_SKILLS)
      throw new HTTPException(409, {
        message: `A workspace has at most ${MAX_SKILLS} skills`,
      });
    await nameTaken(db, body.name);
    const [row] = await db
      .insert(agentSkills)
      .values({
        name: body.name,
        whenToUse: body.whenToUse,
        instructions: body.instructions,
        assignments: body.assignments,
        enabled: body.enabled,
        createdByPrincipalId: actor.principalId,
      })
      .returning(columns)
      .catch(duplicate);
    return view(row!);
  },
});

const updateSkill = defineQuillsRoute({
  method: "patch",
  path: "/assistant/skills/{skillId}",
  operationId: "updateQuillsSkill",
  summary: "Update an assistant skill",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: fields.name.optional(),
      whenToUse: fields.whenToUse.optional(),
      instructions: fields.instructions.optional(),
      assignments: assignments.optional(),
      enabled: fields.enabled.optional(),
    })
    .refine(someField, {
      message: "Change at least one field",
    }),
  response: skillSchema,
  responseDescription: "The updated skill",
  errors,
  event: ({ params }) => ({
    type: "assistant_skill.updated",
    entityType: "assistant_skill",
    entityId: params.skillId,
  }),
  handler: async ({ db, params, body }) => {
    if (body.name) await nameTaken(db, body.name, params.skillId);
    const [row] = await db
      .update(agentSkills)
      .set({
        name: body.name,
        whenToUse: body.whenToUse,
        instructions: body.instructions,
        assignments: body.assignments,
        enabled: body.enabled,
        updatedAt: new Date(),
      })
      .where(eq(agentSkills.id, params.skillId))
      .returning(columns)
      .catch(duplicate);
    if (!row) throw new HTTPException(404, { message: "Skill not found" });
    return view(row);
  },
});

const deleteSkill = defineQuillsRoute({
  method: "delete",
  path: "/assistant/skills/{skillId}",
  operationId: "deleteQuillsSkill",
  summary: "Delete an assistant skill",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted skill's ID",
  errors: { 404: "Skill not found" },
  event: ({ params }) => ({
    type: "assistant_skill.deleted",
    entityType: "assistant_skill",
    entityId: params.skillId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .delete(agentSkills)
      .where(eq(agentSkills.id, params.skillId))
      .returning({ id: agentSkills.id });
    if (!row) throw new HTTPException(404, { message: "Skill not found" });
    return { id: row.id };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listSkills)
  .openapi(...createSkill)
  .openapi(...updateSkill)
  .openapi(...deleteSkill);
