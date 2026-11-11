// Mounts the P1 taxonomy routes declared with ../framework/define-route, so boundaries.test.ts checks these imports too.
import { apiRouter, type BaseVariables } from "../../openapi";
import changelog from "./changelog";
import changelogCategories from "./changelog-categories";
import changelogSettings from "./changelog-settings";
import merge from "./merge";
import moderation from "./moderation";
import postViews from "./post-views";
import roadmapColumns from "./roadmap-columns";
import roadmapPosts from "./roadmap-posts";
import roadmaps from "./roadmaps";
import statuses from "./statuses";
import tags from "./tags";

// Static /changelog/* paths mount before /changelog/{entryId}.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", tags)
  .route("/", statuses)
  .route("/", roadmaps)
  .route("/", roadmapColumns)
  .route("/", roadmapPosts)
  .route("/", changelogCategories)
  .route("/", changelogSettings)
  .route("/", changelog)
  .route("/", moderation)
  .route("/", merge)
  .route("/", postViews);
