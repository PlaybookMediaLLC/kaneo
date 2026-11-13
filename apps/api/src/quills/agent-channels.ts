import { apiRouter, type BaseVariables } from "../openapi";
import slackAgent from "./assistant/slack-agent";
import segment from "./integrations/segment";
import githubInbox from "./support/github-inbox";

// RFC 0001 lane G1: the teammate routes of the agent channels. The signed hooks mount with
// integrations/inbound.ts. See integrations/ROUTES-OAUTH.md, "Agent channels".
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", slackAgent)
  .route("/", githubInbox)
  .route("/", segment);
