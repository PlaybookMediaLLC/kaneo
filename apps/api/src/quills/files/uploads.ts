import { apiRouter, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  contentPurposes,
  createUpload,
  settingsPurposes,
  uploadRequest,
  uploadResponse,
} from "../framework/files";

const upload = (settings: boolean) =>
  defineQuillsRoute({
    method: "post",
    path: settings ? "/files/settings-uploads" : "/files/uploads",
    operationId: settings ? "createQuillsSettingsUpload" : "createQuillsUpload",
    summary: settings
      ? "Request an upload URL for a workspace logo, favicon, header logo or assistant avatar"
      : "Request an upload URL for a file or a post or changelog image",
    description:
      "Returns a presigned PUT for a server-chosen key in the caller's workspace. Register the upload afterwards; an unregistered upload is not a reference.",
    action: settings ? "manage_settings" : "create",
    body: uploadRequest(settings ? settingsPurposes : contentPurposes),
    response: uploadResponse,
    responseDescription: "Presigned upload",
    event: {
      none: "Signs an upload URL; a later request registers the upload",
    },
    handler: ({ body, workspaceId }) => createUpload(workspaceId, body),
  });

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...upload(false))
  .openapi(...upload(true));
