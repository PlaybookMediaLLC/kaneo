import { feedbackStages } from "./feedback-stages";

const order = ["planned", "in_progress", "shipped"] as const;
export type RoadmapStage = (typeof order)[number];

/**
 * The roadmap columns: the public stages after open, in workflow order. Only stages with a
 * status marked for the roadmap appear; with no marked status, every stage appears.
 */
export function roadmapStages(
  statuses: Array<{
    stage: string | null;
    name: string;
    color?: string;
    showOnRoadmap?: boolean;
  }>,
) {
  const marked = statuses.filter((status) => status.showOnRoadmap);
  return feedbackStages(marked.length ? marked : statuses)
    .filter((stage): stage is typeof stage & { value: RoadmapStage } =>
      (order as readonly string[]).includes(stage.value),
    )
    .sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
}
