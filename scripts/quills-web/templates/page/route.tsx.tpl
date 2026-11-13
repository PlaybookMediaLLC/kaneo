import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { {{COMPONENT}}Page } from "@/quills/pages/{{ID}}/{{ID}}-page";
{{I18N_IMPORT}}{{TOKEN_IMPORT}}{{PREFETCH_IMPORTS}}const searchSchema = z.object({ {{FIELDS}} });
export const Route = createFileRoute({{ROUTE}})({ validateSearch: searchSchema, {{BEFORE_LOAD}}component: RouteComponent });
function RouteComponent() { const params = Route.useParams(); return <{{COMPONENT}}Page workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""} params={params} search={Route.useSearch()} />; }
