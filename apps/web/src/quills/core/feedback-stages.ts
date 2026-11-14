export type FeedbackStage = "open" | "planned" | "in_progress" | "shipped";

/** One option per public stage, named after its first status in workflow order. */
export function feedbackStages(
  statuses: Array<{ stage: string | null; name: string; color?: string }>,
) {
  const stages = new Map<
    string,
    { value: FeedbackStage; label: string; color: string | null }
  >();
  for (const status of statuses)
    if (status.stage && !stages.has(status.stage))
      stages.set(status.stage, {
        value: status.stage as FeedbackStage,
        label: status.name,
        color: status.color ?? null,
      });
  return [...stages.values()];
}
