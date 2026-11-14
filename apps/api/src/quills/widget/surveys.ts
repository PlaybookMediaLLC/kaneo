import { apiRouter } from "../../openapi";
import { surveyRoutes } from "../portal/surveys";

// The widget's survey routes (audience "widget", under /widget/surveys).
export default apiRouter().route("/", surveyRoutes("widget"));
