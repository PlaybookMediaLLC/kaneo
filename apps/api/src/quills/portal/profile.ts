import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { httpUrl, requirePortal } from "./feedback/viewer";

// The calling Kaneo account's customer profile in this workspace (decision D1). Every route
// acts on the caller's own link; no route takes another person's ID except the public avatar.
// The Kaneo account (its email, password and sessions) belongs to Kaneo and is never changed here.

const profile = z.object({
  linked: z.boolean(),
  principalId: z.string().nullable(),
  customerId: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
});

const getProfile = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/user/profile",
  operationId: "getQuillsCustomerProfile",
  summary: "Get the caller's customer profile",
  description:
    "linked is false until the account first acts in this workspace; name and email then come from the Kaneo account.",
  action: "read",
  response: profile,
  responseDescription: "The caller's customer profile",
  handler: async ({ db, caller }) => {
    await requirePortal(db);
    const account = caller.account!;
    const [row] = caller.customerId
      ? await db
          .select({ name: customer.name, image: customer.image })
          .from(customer)
          .where(eq(customer.id, caller.customerId))
          .limit(1)
      : [];
    return {
      linked: Boolean(caller.principalId),
      principalId: caller.principalId,
      customerId: caller.customerId,
      name: row?.name ?? account.name,
      email: account.email,
      avatarUrl: httpUrl(row ? row.image : account.image),
    };
  },
});

const updateProfile = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/user/profile",
  operationId: "updateQuillsCustomerProfile",
  summary: "Update the caller's customer profile",
  description:
    "Creates the profile when the account has none here. Changes the name in this workspace only.",
  action: "update",
  // Each unlink and update can create a new profile; bound how often one client can do it.
  rateLimit: { limit: 30, windowSeconds: 600 },
  body: z.object({ name: z.string().trim().min(2).max(100) }),
  response: profile,
  responseDescription: "The caller's customer profile",
  event: (_input, result) => ({
    type: "customer.profile_updated",
    entityType: "principal",
    entityId: result.principalId!,
  }),
  handler: async ({ db, caller, body }) => {
    await requirePortal(db);
    const [row] = await db
      .update(customer)
      .set({ name: body.name })
      .where(eq(customer.id, caller.customerId!))
      .returning({ image: customer.image });
    await db
      .update(principal)
      .set({ displayName: body.name })
      .where(eq(principal.id, caller.principalId!));
    return {
      linked: true,
      principalId: caller.principalId,
      customerId: caller.customerId,
      name: body.name,
      email: caller.account!.email,
      avatarUrl: httpUrl(row?.image ?? null),
    };
  },
});

const unlinkProfile = defineQuillsRoute({
  audience: "portal",
  method: "delete",
  path: "/user/profile",
  operationId: "unlinkQuillsCustomerProfile",
  summary: "Unlink the caller's customer profile",
  description:
    "Removes the link between the Kaneo account and its customer profile here. The profile, its history and the Kaneo account stay.",
  action: "delete",
  rateLimit: { limit: 30, windowSeconds: 600 },
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a link was removed",
  event: ({ workspaceId }, result) =>
    result.changed && {
      type: "customer.profile_unlinked",
      entityType: "workspace",
      entityId: workspaceId,
    },
  handler: async ({ db, caller }) => {
    await requirePortal(db);
    return {
      changed:
        (
          await db
            .update(customer)
            .set({ kaneoUserId: null })
            .where(eq(customer.kaneoUserId, caller.account!.id))
            .returning({ id: customer.id })
        ).length > 0,
    };
  },
});

const avatar = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/user/avatar/{customerId}",
  operationId: "getQuillsCustomerAvatar",
  summary: "Get a customer's avatar URL",
  description:
    "JSON instead of the source's redirect. Only http(s) URLs are returned.",
  action: "read",
  params: z.object({ customerId: flexibleToTypeIdSchema("user") }),
  response: z.object({ url: z.string().nullable() }),
  responseDescription: "The avatar URL, or null",
  errors: { 404: "Customer not found" },
  handler: async ({ db, params }) => {
    await requirePortal(db);
    const [row] = await db
      .select({ image: customer.image })
      .from(customer)
      // Only a customer with a principal is a person of this workspace's portal.
      .innerJoin(principal, eq(principal.userId, customer.id))
      .where(eq(customer.id, params.customerId))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Customer not found" });
    return { url: httpUrl(row.image) };
  },
});

export default apiRouter()
  .openapi(...getProfile)
  .openapi(...updateProfile)
  .openapi(...unlinkProfile)
  .openapi(...avatar);
