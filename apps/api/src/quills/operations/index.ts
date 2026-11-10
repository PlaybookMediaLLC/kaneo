import { apiRouter, type BaseVariables } from "../../openapi";
import domains from "./domains";
import poweredBy from "./powered-by";
import sendingDomains from "./sending-domains";
import usage from "./usage";
import wipe from "./wipe";

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", domains)
  .route("/", sendingDomains)
  .route("/", usage)
  .route("/", poweredBy)
  .route("/", wipe);
