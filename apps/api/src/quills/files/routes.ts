import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { isQuillsStorageConfigured } from "../framework/files";
import files from "./files";
import settingsKeys from "./settings-keys";
import uploads from "./uploads";

const status = defineQuillsRoute({
  method: "get",
  path: "/storage",
  operationId: "checkQuillsS3Configured",
  summary: "Check whether file storage is configured",
  action: "read",
  response: z.object({ configured: z.boolean() }),
  responseDescription: "Storage status",
  handler: async () => ({ configured: isQuillsStorageConfigured() }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...status)
  .route("/", uploads)
  .route("/", files)
  .route("/", settingsKeys);
