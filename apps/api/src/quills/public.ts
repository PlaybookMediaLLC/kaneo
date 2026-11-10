import { apiRouter } from "../openapi";
import portal from "./portal/index";
import widget from "./widget/index";

// Portal, widget and public Quills routes. src/index.ts mounts this router at /quills-public
// before Kaneo's session middleware: each route resolves its own caller in framework/audience.ts
// and never runs through withQuillsRequest.
export default apiRouter().route("/", portal).route("/", widget);
