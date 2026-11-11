import { apiRouter, z } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { wakeQuillsJobs } from "../framework/internal";

// POST /quills-public/internal/job-wake: an operator's scheduler or a sidecar asks for one pass of the
// job loop now, instead of waiting for the next scheduler tick. QUILLS_INTERNAL_TOKEN authorizes it;
// without the variable the route is 404. It is hidden from the OpenAPI document.
const wake = defineQuillsRoute({
  audience: "internal",
  method: "post",
  path: "/job-wake",
  operationId: "wakeQuillsJobs",
  summary: "Run one pass of the Quills job loop",
  action: "manage_settings",
  response: z.object({ degraded: z.boolean() }),
  responseDescription:
    "The pass ran; degraded is true when a job or a workspace failed",
  event: { none: "Runs queued jobs; each job records its own changes" },
  handler: async () => ({ degraded: (await wakeQuillsJobs()).degraded }),
});

export default apiRouter().openapi(...wake);
