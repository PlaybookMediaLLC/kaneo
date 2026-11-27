import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../../database/quills/client";
import { agentSkills } from "../../../database/quills/schema/agent-skills";
import { assistantGuidanceRules } from "../../../database/quills/schema/assistant-guidance";

// The guidance rules and skills that a teammate aimed at one agent, and their prompt lines. The
// copilot and the customer agent read them the same way.

export type Agent = "copilot" | "agent";

/** At most 20 enabled rules in priority order, and 10 enabled skills assigned to the agent. */
export async function loadGuidance(db: Database, agent: Agent) {
  const rules = await db
    .select({
      id: assistantGuidanceRules.id,
      name: assistantGuidanceRules.name,
      appliesWhen: assistantGuidanceRules.appliesWhen,
      instruction: assistantGuidanceRules.instruction,
    })
    .from(assistantGuidanceRules)
    .where(
      and(
        eq(assistantGuidanceRules.agent, agent),
        eq(assistantGuidanceRules.enabled, true),
      ),
    )
    .orderBy(asc(assistantGuidanceRules.priority))
    .limit(20);
  const skills = await db
    .select({
      id: agentSkills.id,
      name: agentSkills.name,
      whenToUse: agentSkills.whenToUse,
      instructions: agentSkills.instructions,
      assignments: agentSkills.assignments,
      allowedTools: agentSkills.allowedTools,
    })
    .from(agentSkills)
    .where(
      and(
        eq(agentSkills.enabled, true),
        sql`${agentSkills.assignments} @> ${JSON.stringify({ [agent]: true })}::jsonb`,
      ),
    )
    .orderBy(asc(agentSkills.name))
    .limit(10);
  return { rules, skills };
}

/** One system-prompt line for each rule and each skill. */
export const guidanceLines = ({
  rules,
  skills,
}: Awaited<ReturnType<typeof loadGuidance>>) => [
  ...rules.map(
    (rule) =>
      `Guidance "${rule.name}"${rule.appliesWhen ? ` (when ${rule.appliesWhen})` : ""}: ${rule.instruction}`,
  ),
  ...skills.map(
    (skill) =>
      `Skill "${skill.name}" (use when ${skill.whenToUse}):\n${skill.instructions.slice(0, 2000)}`,
  ),
];
