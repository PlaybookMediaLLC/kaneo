import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { macros } from "../../database/quills/schema/macros";
import { teams } from "../../database/quills/schema/teams";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import { findTeam, findTeammate, notFound, PRIORITIES } from "./ticket-view";

type Action = (typeof macros.$inferSelect)["actions"][number];
const errors = { 404: "Macro, conversation, teammate, team or tag not found" };
const SCOPES = ["support", "feedback", "both"] as const;
const PRESETS = ["until_reply", "tomorrow", "next_week"] as const;
const VARIABLES = [
  "firstName",
  "lastName",
  "email",
  "conversationTitle",
] as const;
const params = z.object({ macroId: flexibleToTypeIdSchema("macro") });
const loadMembers = ({ workspaceId }: { workspaceId: string }) =>
  memberUserIds(workspaceId);

const actionInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign_agent"),
    principalId: flexibleToTypeIdSchema("principal"),
  }),
  z.object({
    type: z.literal("assign_team"),
    teamId: flexibleToTypeIdSchema("team"),
  }),
  z.object({
    type: z.literal("add_tag"),
    tagId: flexibleToTypeIdSchema("conversation_tag"),
  }),
  z.object({ type: z.literal("set_priority"), priority: z.enum(PRIORITIES) }),
  z.object({ type: z.literal("snooze"), preset: z.enum(PRESETS) }),
  z.object({ type: z.literal("close") }),
  z.object({
    type: z.literal("set_attribute"),
    key: z.string().min(1).max(80),
    value: z.union([
      z.string().max(1000),
      z.number(),
      z.boolean(),
      z.array(z.string().max(200)).max(50),
      z.null(),
    ]),
  }),
]);
const actionsInput = z.array(actionInput).max(20);

const actionSchema = z.object({
  type: z.enum([
    "assign_agent",
    "assign_team",
    "add_tag",
    "set_priority",
    "snooze",
    "close",
    "set_attribute",
  ]),
  principalId: z.string().optional(),
  teamId: z.string().optional(),
  tagId: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  preset: z.enum(PRESETS).optional(),
  key: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
  /** A list value of set_attribute. */
  values: z.array(z.string()).optional(),
});
const macroSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
  scope: z.enum(SCOPES),
  actions: z.array(actionSchema),
});
const columns = {
  id: macros.id,
  name: macros.name,
  body: macros.body,
  scope: macros.scope,
  actions: macros.actions,
};
type MacroRow = {
  [K in keyof typeof columns]: (typeof macros.$inferSelect)[K];
};

const view = (row: MacroRow): z.input<typeof macroSchema> => ({
  ...row,
  actions: row.actions.map((action): z.input<typeof actionSchema> => {
    if (action.type !== "set_attribute") return action;
    return Array.isArray(action.value)
      ? { type: action.type, key: action.key, values: action.value }
      : { type: action.type, key: action.key, value: action.value };
  }),
});

/** Every teammate, team and tag an action names must exist in this workspace. */
async function checkActions(
  db: Database,
  members: readonly string[],
  actions: z.output<typeof actionsInput>,
) {
  for (const action of actions) {
    if (action.type === "assign_agent")
      await findTeammate(db, members, action.principalId);
    if (action.type === "assign_team") await findTeam(db, action.teamId);
    if (action.type === "add_tag") {
      const [tag] = await db
        .select({ id: conversationTags.id })
        .from(conversationTags)
        .where(
          and(
            eq(conversationTags.id, action.tagId),
            isNull(conversationTags.deletedAt),
          ),
        );
      if (!tag) throw notFound("Tag");
    }
  }
}

async function findMacro(db: Database, id: MacroRow["id"]) {
  const [row] = await db
    .select(columns)
    .from(macros)
    .where(and(eq(macros.id, id), isNull(macros.deletedAt)));
  if (!row) throw notFound("Macro");
  return row;
}

const listMacros = defineQuillsRoute({
  method: "get",
  path: "/macros",
  operationId: "listQuillsMacros",
  summary: "List saved replies (macros)",
  description:
    "`surface` limits the list to the macros a composer offers: its own scope and `both`.",
  action: "read",
  query: z.object({ surface: z.enum(["support", "feedback"]).optional() }),
  response: z.object({ items: z.array(macroSchema) }),
  responseDescription: "The macros",
  handler: async ({ db, query }) => ({
    items: (
      await db
        .select(columns)
        .from(macros)
        .where(
          and(
            isNull(macros.deletedAt),
            query.surface && inArray(macros.scope, [query.surface, "both"]),
          ),
        )
        .orderBy(desc(macros.createdAt))
        // ponytail: a macro library is hundreds at most; page it if one grows past this.
        .limit(500)
    ).map(view),
  }),
});

const name = z.string().trim().min(1).max(80);
const body = z.string().min(1).max(4000);

const createMacro = defineQuillsRoute({
  method: "post",
  path: "/macros",
  operationId: "createQuillsMacro",
  summary: "Create a macro",
  action: "manage_settings",
  body: z.object({
    name,
    body,
    scope: z.enum(SCOPES).default("support"),
    actions: actionsInput.default([]),
  }),
  response: macroSchema,
  responseDescription: "The new macro",
  errors,
  event: (_input, macro) => ({
    type: "macro.created",
    entityType: "macro",
    entityId: macro.id,
  }),
  load: loadMembers,
  handler: async ({ db, actor, body: input, loaded }) => {
    await checkActions(db, loaded, input.actions);
    const [row] = await db
      .insert(macros)
      .values({
        name: input.name,
        body: input.body,
        scope: input.scope,
        actions: input.actions as Action[],
        createdByPrincipalId: actor.principalId,
      })
      .returning(columns);
    return view(row!);
  },
});

const updateMacro = defineQuillsRoute({
  method: "patch",
  path: "/macros/{macroId}",
  operationId: "updateQuillsMacro",
  summary: "Update a macro",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: name.optional(),
      body: body.optional(),
      scope: z.enum(SCOPES).optional(),
      actions: actionsInput.optional(),
    })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Send at least one field",
    ),
  response: macroSchema,
  responseDescription: "The macro",
  errors,
  event: ({ params }) => ({
    type: "macro.updated",
    entityType: "macro",
    entityId: params.macroId,
  }),
  load: loadMembers,
  handler: async ({ db, params, body: input, loaded }) => {
    await findMacro(db, params.macroId);
    if (input.actions) await checkActions(db, loaded, input.actions);
    const [row] = await db
      .update(macros)
      .set({
        name: input.name,
        body: input.body,
        scope: input.scope,
        actions: input.actions as Action[] | undefined,
        updatedAt: new Date(),
      })
      .where(eq(macros.id, params.macroId))
      .returning(columns);
    return view(row!);
  },
});

const deleteMacro = defineQuillsRoute({
  method: "delete",
  path: "/macros/{macroId}",
  operationId: "deleteQuillsMacro",
  summary: "Delete a macro",
  description:
    "Soft delete: the row stays for attribution and leaves every list.",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted macro",
  errors,
  event: ({ params }) => ({
    type: "macro.deleted",
    entityType: "macro",
    entityId: params.macroId,
  }),
  handler: async ({ db, params }) => {
    await findMacro(db, params.macroId);
    await db
      .update(macros)
      .set({ deletedAt: new Date() })
      .where(eq(macros.id, params.macroId));
    return { id: params.macroId };
  },
});

/** 09:00 UTC on the day after `from`, plus `extraDays`. */
const nineAm = (from: Date, extraDays: number) => {
  const at = new Date(from);
  at.setUTCDate(at.getUTCDate() + 1 + extraDays);
  at.setUTCHours(9, 0, 0, 0);
  return at;
};

const applyMacro = defineQuillsRoute({
  method: "post",
  path: "/macros/{macroId}/apply",
  operationId: "applyQuillsMacro",
  summary: "Apply a macro to a conversation",
  description:
    "Returns the macro body with {firstName}, {lastName}, {email} and {conversationTitle} filled in, and runs its actions on the conversation in one transaction. An action whose teammate, team or tag is gone is skipped and not listed in `applied`.",
  action: "update",
  params,
  body: z.object({ conversationId: flexibleToTypeIdSchema("conversation") }),
  response: z.object({ body: z.string(), applied: z.array(z.string()) }),
  responseDescription: "The rendered body and the applied actions",
  errors,
  event: ({ params, body: input }) => ({
    type: "macro.applied",
    entityType: "macro",
    entityId: params.macroId,
    payload: { conversationId: input.conversationId },
  }),
  load: loadMembers,
  handler: async ({ db, params, body: input, loaded }) => {
    const macro = await findMacro(db, params.macroId);
    const [locked] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for("update");
    if (!locked) throw notFound("Conversation");
    const [conversation] = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        customAttributes: conversations.customAttributes,
        displayName: principal.displayName,
        contactEmail: principal.contactEmail,
        userName: user.name,
        userEmail: user.email,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(conversations.id, locked.id));
    if (!conversation) throw notFound("Conversation");
    const fullName = (
      conversation.userName ??
      conversation.displayName ??
      ""
    ).trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    // Synthetic visitor addresses (packages/email anon domain) are never shown as an email.
    const real = (email: string | null) =>
      email && !email.toLowerCase().endsWith("@anon.quills.io") ? email : null;
    const context: Record<(typeof VARIABLES)[number], string | null> = {
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
      email: real(conversation.userEmail) ?? real(conversation.contactEmail),
      conversationTitle: conversation.subject,
    };
    const rendered = macro.body.replace(/\{(\w+)\}/g, (_m, token: string) =>
      (VARIABLES as readonly string[]).includes(token)
        ? (context[token as (typeof VARIABLES)[number]] ?? "")
        : "",
    );
    const now = new Date();
    const applied: string[] = [];
    const set: Partial<typeof conversations.$inferInsert> = {};
    const attributes = {
      ...(conversation.customAttributes as Record<string, unknown>),
    };
    for (const action of macro.actions) {
      switch (action.type) {
        case "assign_agent": {
          const teammate = await findTeammate(
            db,
            loaded,
            action.principalId as never,
          ).catch(() => null);
          if (!teammate) break;
          set.assignedAgentPrincipalId = teammate.id;
          applied.push(`Assigned to ${teammate.displayName ?? "a teammate"}`);
          break;
        }
        case "assign_team": {
          const [team] = await db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(
              and(
                eq(teams.id, action.teamId as never),
                isNull(teams.deletedAt),
              ),
            );
          if (!team) break;
          set.assignedTeamId = team.id;
          applied.push(`Assigned to team ${team.name}`);
          break;
        }
        case "add_tag": {
          const [tag] = await db
            .select({ id: conversationTags.id, name: conversationTags.name })
            .from(conversationTags)
            .where(
              and(
                eq(conversationTags.id, action.tagId as never),
                isNull(conversationTags.deletedAt),
              ),
            );
          if (!tag) break;
          await db
            .insert(conversationTagAssignments)
            .values({
              conversationId: conversation.id,
              conversationTagId: tag.id,
            })
            .onConflictDoNothing();
          applied.push(`Tagged ${tag.name}`);
          break;
        }
        case "set_priority":
          set.priority = action.priority;
          applied.push(`Priority set to ${action.priority}`);
          break;
        case "snooze":
          set.status = "snoozed";
          set.snoozedUntil =
            action.preset === "until_reply"
              ? null
              : nineAm(now, action.preset === "next_week" ? 6 : 0);
          applied.push("Snoozed");
          break;
        case "close":
          set.status = "closed";
          set.snoozedUntil = null;
          set.resolvedAt = now;
          applied.push("Closed");
          break;
        case "set_attribute":
          attributes[action.key] = action.value;
          set.customAttributes = attributes;
          applied.push(`Set ${action.key}`);
          break;
      }
    }
    if (Object.keys(set).length)
      await db
        .update(conversations)
        .set({ ...set, updatedAt: now })
        .where(eq(conversations.id, conversation.id));
    return { body: rendered, applied };
  },
});

/** Teammate routes for macros: the library and applying one to a conversation. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listMacros)
  .openapi(...createMacro)
  .openapi(...updateMacro)
  .openapi(...deleteMacro)
  .openapi(...applyMacro);
