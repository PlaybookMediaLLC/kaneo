import { fixture } from "../framework/contract";

const range = fixture({
  seed: async () => ({}),
  valid: () => {
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    return { query: { from: day(-30), to: day(0) } };
  },
});

export const getQuillsQuinnPerformance = range;
export const getQuillsQuinnToolMetrics = range;
export const getQuillsCopilotUsageMetrics = range;
