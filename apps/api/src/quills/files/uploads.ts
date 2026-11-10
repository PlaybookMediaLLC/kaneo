import { apiRouter, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  contentPurposes,
  createUpload,
  settingsPurposes,
  uploadRequest,
  uploadResponse,
  type Purpose,
} from "../framework/files";

// Generic, so each route keeps its literal path and purpose list in the typed client.
const upload = <
  Path extends string,
  P extends readonly [Purpose, ...Purpose[]],
>(d: {
  path: Path;
  operationId: string;
  summary: string;
  action: "create" | "manage_settings";
  purposes: P;
}) =>
  defineQuillsRoute({
    method: "post",
    path: d.path,
    operationId: d.operationId,
    summary: d.summary,
    description:
      "Returns a presigned PUT for a server-chosen key in the caller's workspace. Register the upload afterwards; an unregistered upload is not a reference.",
    action: d.action,
    body: uploadRequest(d.purposes),
    response: uploadResponse,
    responseDescription: "Presigned upload",
    event: {
      none: "Signs an upload URL; a later request registers the upload",
    },
    // Signing may resolve provider credentials, so it runs before the transaction.
    load: ({ body, workspaceId }) => createUpload(workspaceId, body),
    handler: async ({ loaded }) => loaded,
  });

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(
    ...upload({
      path: "/files/uploads",
      operationId: "createQuillsUpload",
      summary: "Request an upload URL for a file or a post or changelog image",
      action: "create",
      purposes: contentPurposes,
    }),
  )
  .openapi(
    ...upload({
      path: "/files/settings-uploads",
      operationId: "createQuillsSettingsUpload",
      summary:
        "Request an upload URL for a workspace logo, favicon, header logo or assistant avatar",
      action: "manage_settings",
      purposes: settingsPurposes,
    }),
  );
