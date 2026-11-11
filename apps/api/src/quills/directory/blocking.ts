import { and, eq, isNull, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { loadCustomer } from "./customer";

// Only customers can be blocked: loadCustomer rejects teammates, service principals and test customers.
const params = z.object({ principalId: flexibleToTypeIdSchema("principal") });
const status = z.object({ blockedAt: nullableResponseTimestamp });
const errors = { 404: "Person not found" };

const getBlock = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}/block",
  operationId: "getQuillsUserBlock",
  summary: "Get whether a customer is blocked",
  action: "read",
  params,
  response: status,
  responseDescription: "Block status",
  errors,
  handler: async ({ db, params }) => ({
    blockedAt: (await loadCustomer(db, params.principalId)).blockedAt,
  }),
});

const block = defineQuillsRoute({
  method: "put",
  path: "/users/{principalId}/block",
  operationId: "blockQuillsUser",
  summary: "Block a customer",
  action: "update",
  params,
  response: status,
  responseDescription: "Block status",
  errors,
  event: ({ params }) => ({
    type: "user.blocked",
    entityType: "principal",
    entityId: params.principalId,
  }),
  handler: async ({ db, actor, params }) => {
    await loadCustomer(db, params.principalId, true);
    // An existing block keeps its original time and actor.
    await db
      .update(principal)
      .set({
        blockedAt: sql`now()`,
        blockedByPrincipalId: actor.principalId,
      })
      .where(
        and(eq(principal.id, params.principalId), isNull(principal.blockedAt)),
      );
    return {
      blockedAt: (await loadCustomer(db, params.principalId)).blockedAt,
    };
  },
});

const unblock = defineQuillsRoute({
  method: "delete",
  path: "/users/{principalId}/block",
  operationId: "unblockQuillsUser",
  summary: "Unblock a customer",
  action: "update",
  params,
  response: status,
  responseDescription: "Block status",
  errors,
  event: ({ params }) => ({
    type: "user.unblocked",
    entityType: "principal",
    entityId: params.principalId,
  }),
  handler: async ({ db, params }) => {
    await loadCustomer(db, params.principalId, true);
    await db
      .update(principal)
      .set({ blockedAt: null, blockedByPrincipalId: null })
      .where(eq(principal.id, params.principalId));
    return { blockedAt: null };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getBlock)
  .openapi(...block)
  .openapi(...unblock);
