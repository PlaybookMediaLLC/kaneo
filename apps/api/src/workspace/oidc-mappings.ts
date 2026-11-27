import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { oidcGroupRoleMappingTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { workspaceIdParam } from "./schema";

const oidcMappingSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    groupName: z.string(),
    role: z.string(),
    priority: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("OidcGroupRoleMapping");

const listMappingsRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceOidcGroupMappings",
  path: "/{workspaceId}/oidc-group-mappings",
  tags: ["Workspaces"],
  summary: "List OIDC group-to-role mappings for this workspace",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "OIDC group mappings",
      z.object({ items: z.array(oidcMappingSchema) }),
    ),
    403: errorResponse("Missing workspace:read permission"),
  },
});

const upsertMappingRoute = createRoute({
  method: "put",
  operationId: "upsertWorkspaceOidcGroupMapping",
  path: "/{workspaceId}/oidc-group-mappings",
  tags: ["Workspaces"],
  summary: "Create or update an OIDC group-to-role mapping for this workspace",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            groupName: z.string().trim().min(1).max(200),
            role: z.string().trim().min(1).max(100),
            priority: z.number().int().min(0).max(1000).default(0),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonResponse("Saved OIDC group mapping", oidcMappingSchema),
    403: errorResponse("Missing workspace:update permission"),
  },
});

const deleteMappingRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkspaceOidcGroupMapping",
  path: "/{workspaceId}/oidc-group-mappings/{mappingId}",
  tags: ["Workspaces"],
  summary: "Delete an OIDC group-to-role mapping",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: {
    params: workspaceIdParam.extend({
      mappingId: z.string().min(1).max(100),
    }),
  },
  responses: {
    200: jsonResponse("Deleted mapping ID", z.object({ id: z.string() })),
    403: errorResponse("Missing workspace:update permission"),
    404: errorResponse("Mapping not found"),
  },
});

const oidcMappingRoutes = apiRouter<BaseVariables>()
  .openapi(listMappingsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const items = await db
      .select()
      .from(oidcGroupRoleMappingTable)
      .where(eq(oidcGroupRoleMappingTable.workspaceId, workspaceId))
      .orderBy(desc(oidcGroupRoleMappingTable.priority));
    return c.json({ items }, 200);
  })
  .openapi(upsertMappingRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(oidcGroupRoleMappingTable)
      .values({
        workspaceId,
        groupName: body.groupName,
        role: body.role,
        priority: body.priority,
      })
      .onConflictDoUpdate({
        target: [
          oidcGroupRoleMappingTable.workspaceId,
          oidcGroupRoleMappingTable.groupName,
        ],
        set: {
          role: body.role,
          priority: body.priority,
          updatedAt: new Date(),
        },
      })
      .returning();
    return c.json(row!, 200);
  })
  .openapi(deleteMappingRoute, async (c) => {
    const { workspaceId, mappingId } = c.req.valid("param");
    const [deleted] = await db
      .delete(oidcGroupRoleMappingTable)
      .where(
        and(
          eq(oidcGroupRoleMappingTable.id, mappingId),
          eq(oidcGroupRoleMappingTable.workspaceId, workspaceId),
        ),
      )
      .returning({ id: oidcGroupRoleMappingTable.id });
    if (!deleted) {
      throw new HTTPException(404, { message: "Mapping not found" });
    }
    return c.json(deleted, 200);
  });

export default oidcMappingRoutes;
