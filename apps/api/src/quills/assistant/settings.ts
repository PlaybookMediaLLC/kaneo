import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  settings,
  type StoredAssistantConfig,
} from "../../database/quills/schema/auth";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { aiConfig } from "./provider";
import { TOOL_NAMES } from "./tools";

// The assistant's identity, voice, knowledge sources and tool rules, in settings.assistant_config.
// One read and one update replace the source's seven per-section update functions.

const MODES = ["propose", "off"] as const;
const toolRules = z
  .array(z.object({ tool: z.enum(TOOL_NAMES), mode: z.enum(MODES) }))
  .max(TOOL_NAMES.length);
const voice = z.object({
  tone: z.enum(["friendly", "balanced", "formal"]),
  responseLength: z.enum(["concise", "balanced", "detailed"]),
  additionalInstructions: z.string().max(2000),
});
const agentKnowledge = z.object({
  helpCenter: z.boolean(),
  posts: z.boolean(),
  changelog: z.boolean(),
  documents: z.boolean(),
  status: z.boolean(),
});
const copilotKnowledge = agentKnowledge.extend({
  pastConversations: z.boolean(),
  internalNotes: z.boolean(),
  tickets: z.boolean(),
});
const response = z.object({
  revision: z.number(),
  aiConfigured: z.boolean(),
  embeddingsConfigured: z.boolean(),
  identity: z.object({ name: z.string() }),
  agent: z.object({
    voice,
    knowledge: agentKnowledge,
    toolRules,
  }),
  copilot: z.object({
    qa: z.boolean(),
    knowledge: copilotKnowledge,
    toolRules,
  }),
});

type Config = StoredAssistantConfig;
const rules = (stored: Record<string, string> | undefined) =>
  Object.entries(stored ?? {}).flatMap(([tool, mode]) =>
    (TOOL_NAMES as readonly string[]).includes(tool) &&
    (MODES as readonly string[]).includes(mode)
      ? [{ tool, mode }]
      : [],
  ) as z.input<typeof toolRules>;
const pick = <T extends z.ZodObject>(schema: T, value: unknown) =>
  Object.fromEntries(
    Object.entries(schema.shape).map(([name, field]) => [
      name,
      (field as z.ZodType).safeParse((value as Record<string, unknown>)?.[name])
        .data ?? false,
    ]),
  ) as z.output<T>;

/** The stored configuration with defaults for anything missing or invalid. */
export function readConfig(config: Config) {
  const stored = voice.partial().safeParse(config?.agents?.agent?.voice).data;
  return {
    identity: { name: config?.identity?.name || "Quinn" },
    agent: {
      voice: {
        tone: stored?.tone ?? "balanced",
        responseLength: stored?.responseLength ?? "balanced",
        additionalInstructions: stored?.additionalInstructions ?? "",
      },
      knowledge: pick(agentKnowledge, config?.agents?.agent?.knowledge),
      toolRules: rules(config?.agents?.agent?.toolRules),
    },
    copilot: {
      qa: config?.agents?.copilot?.capabilities?.qa !== false,
      knowledge: pick(copilotKnowledge, config?.agents?.copilot?.knowledge),
      toolRules: rules(config?.agents?.copilot?.toolRules),
    },
  };
}

async function load(db: Database) {
  const [row] = await db
    .select({
      config: settings.assistantConfig,
      revision: settings.assistantConfigRevision,
    })
    .from(settings)
    .limit(1);
  if (!row) throw new Error("Quills workspace was not initialized");
  return row;
}
const view = (row: { config: Config; revision: number }) => {
  const ai = aiConfig();
  return {
    revision: row.revision,
    aiConfigured: Boolean(ai),
    embeddingsConfigured: Boolean(ai?.embeddingModel),
    ...readConfig(row.config),
  };
};

const getSettings = defineQuillsRoute({
  method: "get",
  path: "/assistant/settings",
  operationId: "getQuillsAssistantSettings",
  summary: "Get the assistant settings",
  description:
    "Identity, customer-agent voice and knowledge, copilot Q&A and knowledge, and tool rules. `aiConfigured` is false when the instance has no AI provider.",
  action: "manage_settings",
  response,
  responseDescription: "The assistant settings and their revision",
  handler: async ({ db }) => view(await load(db)),
});

const updateSettings = defineQuillsRoute({
  method: "patch",
  path: "/assistant/settings",
  operationId: "updateQuillsAssistantSettings",
  summary: "Update the assistant settings",
  description:
    "Send the revision you read; another writer's change since then returns 409. Each section you send replaces that section.",
  action: "manage_settings",
  body: z.object({
    revision: z.number().int().min(1).max(2147483647),
    name: z.string().trim().min(1).max(60).optional(),
    agentVoice: voice.optional(),
    agentKnowledge: agentKnowledge.optional(),
    agentToolRules: toolRules.optional(),
    copilotQa: z.boolean().optional(),
    copilotKnowledge: copilotKnowledge.optional(),
    copilotToolRules: toolRules.optional(),
  }),
  response,
  responseDescription: "The updated assistant settings",
  errors: { 409: "The settings changed since you read them" },
  event: () => ({
    type: "settings.assistant_updated",
    entityType: "settings",
    entityId: "assistant",
  }),
  handler: async ({ db, body }) => {
    const row = await load(db);
    if (row.revision !== body.revision)
      throw new HTTPException(409, {
        message: "The settings changed since you read them. Reload them.",
      });
    const current = readConfig(row.config);
    const toMap = (list: z.output<typeof toolRules>) =>
      Object.fromEntries(list.map((rule) => [rule.tool, rule.mode]));
    const agents = row.config?.agents ?? ({} as Config["agents"]);
    const config: Config = {
      ...row.config,
      identity: {
        avatarUrl: row.config?.identity?.avatarUrl ?? null,
        name: body.name ?? current.identity.name,
      },
      agents: {
        ...agents,
        agent: {
          ...agents.agent,
          voice: body.agentVoice ?? current.agent.voice,
          knowledge: body.agentKnowledge ?? current.agent.knowledge,
          toolRules: toMap(body.agentToolRules ?? current.agent.toolRules),
        },
        copilot: {
          ...agents.copilot,
          capabilities: { qa: body.copilotQa ?? current.copilot.qa },
          knowledge: body.copilotKnowledge ?? current.copilot.knowledge,
          toolRules: toMap(body.copilotToolRules ?? current.copilot.toolRules),
        },
      },
    };
    const [updated] = await db
      .update(settings)
      .set({
        assistantConfig: config,
        assistantConfigRevision: sql`${settings.assistantConfigRevision} + 1`,
      })
      .where(eq(settings.assistantConfigRevision, body.revision))
      .returning({
        config: settings.assistantConfig,
        revision: settings.assistantConfigRevision,
      });
    if (!updated)
      throw new HTTPException(409, {
        message: "The settings changed since you read them. Reload them.",
      });
    return view(updated);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSettings)
  .openapi(...updateSettings);
