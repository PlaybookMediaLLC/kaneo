import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { parseJson } from "./area";
import { resolveFlags } from "./labs";

// Lean workspace presets and solo-founder setup state (#307).
// Turning modules off hides their UI/routes without ever deleting workspace data.

export const WORKSPACE_PRESETS = ["solo_founder", "full"] as const;
export type WorkspacePreset = (typeof WORKSPACE_PRESETS)[number];

export const PRESET_MODULES: Record<
  WorkspacePreset,
  Record<
    | "roadmap"
    | "changelog"
    | "helpCenter"
    | "supportInbox"
    | "supportTickets"
    | "statusPage"
    | "surveys"
    | "ai",
    boolean
  >
> = {
  solo_founder: {
    roadmap: true,
    changelog: true,
    helpCenter: true,
    supportInbox: true,
    supportTickets: false,
    statusPage: false,
    surveys: false,
    ai: false,
  },
  full: {
    roadmap: true,
    changelog: true,
    helpCenter: true,
    supportInbox: true,
    supportTickets: true,
    statusPage: true,
    surveys: true,
    ai: true,
  },
};

const setupStateSchema = z.object({
  preset: z.enum(WORKSPACE_PRESETS).nullable(),
  completedSteps: z.array(z.string().trim().min(1).max(64)).max(30),
  dismissed: z.boolean(),
});

function readSetupState(stored: Record<string, unknown>): {
  preset: WorkspacePreset | null;
  completedSteps: string[];
  dismissed: boolean;
} {
  const preset: WorkspacePreset | null =
    stored.preset === "solo_founder" || stored.preset === "full"
      ? stored.preset
      : null;
  const raw =
    stored.setupState && typeof stored.setupState === "object"
      ? (stored.setupState as Record<string, unknown>)
      : {};
  const completedSteps = Array.isArray(raw.completedSteps)
    ? raw.completedSteps.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
  const dismissed = raw.dismissed === true;
  return { preset, completedSteps, dismissed };
}

const modulesSchema = z.object({
  feedback: z.boolean(),
  roadmap: z.boolean(),
  changelog: z.boolean(),
  helpCenter: z.boolean(),
  supportInbox: z.boolean(),
  supportTickets: z.boolean(),
  statusPage: z.boolean(),
  surveys: z.boolean(),
  ai: z.boolean(),
});

const applyPreset = defineQuillsRoute({
  method: "post",
  path: "/settings/preset",
  operationId: "applyQuillsWorkspacePreset",
  summary: "Apply a workspace module preset (solo_founder or full)",
  description:
    "Switches module toggles cleanly without deleting any workspace data. solo_founder keeps feedback, roadmap, changelog, help center and inbox on while hiding tickets, status page, surveys and AI.",
  action: "manage_settings",
  body: z.object({
    preset: z.enum(WORKSPACE_PRESETS),
  }),
  response: z.object({
    preset: z.enum(WORKSPACE_PRESETS),
    modules: modulesSchema,
  }),
  responseDescription: "Applied preset and resolved module flags",
  event: ({ body }) => ({
    type: "settings.preset_applied",
    entityType: "settings",
    entityId: "preset",
    payload: { preset: body.preset },
  }),
  handler: async ({ db, body }) => {
    const [row] = await db
      .select({ id: settings.id, featureFlags: settings.featureFlags })
      .from(settings)
      .limit(1)
      .for("update");
    if (!row)
      throw new HTTPException(404, { message: "Workspace settings not found" });
    const stored = parseJson(row.featureFlags ?? null);
    const next = {
      ...stored,
      ...PRESET_MODULES[body.preset],
      preset: body.preset,
    };
    await db
      .update(settings)
      .set({ featureFlags: JSON.stringify(next) })
      .where(eq(settings.id, row.id));
    return {
      preset: body.preset,
      modules: resolveFlags(next),
    };
  },
});

const getSetupState = defineQuillsRoute({
  method: "get",
  path: "/settings/setup-state",
  operationId: "getQuillsSetupState",
  summary: "Get workspace onboarding setup state and active preset",
  action: "read",
  response: setupStateSchema.extend({ modules: modulesSchema }),
  responseDescription: "Workspace setup state and active module flags",
  handler: async ({ db }) => {
    const [row] = await db
      .select({ featureFlags: settings.featureFlags })
      .from(settings)
      .limit(1);
    const stored = parseJson(row?.featureFlags ?? null);
    return {
      ...readSetupState(stored),
      modules: resolveFlags(stored),
    };
  },
});

const updateSetupState = defineQuillsRoute({
  method: "patch",
  path: "/settings/setup-state",
  operationId: "updateQuillsSetupState",
  summary: "Update workspace onboarding checklist progress or dismiss it",
  action: "manage_settings",
  body: z
    .object({
      completedSteps: z
        .array(z.string().trim().min(1).max(64))
        .max(30)
        .optional(),
      dismissed: z.boolean().optional(),
    })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Change at least one field",
    ),
  response: setupStateSchema,
  responseDescription: "Updated setup state",
  event: () => ({
    type: "settings.setup_state_updated",
    entityType: "settings",
    entityId: "setup_state",
  }),
  handler: async ({ db, body }) => {
    const [row] = await db
      .select({ id: settings.id, featureFlags: settings.featureFlags })
      .from(settings)
      .limit(1)
      .for("update");
    if (!row)
      throw new HTTPException(404, { message: "Workspace settings not found" });
    const stored = parseJson(row.featureFlags ?? null);
    const current = readSetupState(stored);
    const nextSetup = {
      completedSteps:
        body.completedSteps !== undefined
          ? [...new Set(body.completedSteps)]
          : current.completedSteps,
      dismissed:
        body.dismissed !== undefined ? body.dismissed : current.dismissed,
    };
    const nextStored = {
      ...stored,
      setupState: nextSetup,
    };
    await db
      .update(settings)
      .set({
        featureFlags: JSON.stringify(nextStored),
      })
      .where(eq(settings.id, row.id));
    return {
      preset: current.preset,
      ...nextSetup,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...applyPreset)
  .openapi(...getSetupState)
  .openapi(...updateSetupState);
