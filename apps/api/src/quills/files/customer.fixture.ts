import { eq } from "drizzle-orm";
import { user as customer } from "../../database/quills/schema/auth";
import { files } from "../../database/quills/schema/files";
import { fixture, type ContractEnv } from "../framework/contract";
import { createUpload } from "../framework/files";
import { enablePortal } from "../portal/seed.fixture";
import { image } from "./seed.fixture";

type Purpose = "customer_file" | "customer_image" | "customer_avatar";
type CustomerId = typeof customer.$inferSelect.id;
const request = (purpose: Purpose) => ({
  purpose,
  filename: "image.png",
  ...image,
});
const keyFor = async (
  workspaceId: string,
  customerId: string,
  purpose: Purpose,
) => (await createUpload(workspaceId, request(purpose), customerId)).key;

/** Customer A's portal profile in A and an upload of it; customer B's upload in B. */
async function portalUploads(env: ContractEnv, purpose: Purpose) {
  await enablePortal(env, env.a);
  const a = await env.portalCustomer(env.a, env.customerA);
  const b = await env.portalCustomer(env.b, env.customerB);
  return {
    ...a,
    key: await keyFor(env.a, a.customerId, purpose),
    foreignKey: await keyFor(env.b, b.customerId, purpose),
  };
}

/** A widget visitor of A and an upload of it; a visitor's upload in B. */
async function widgetUploads(env: ContractEnv) {
  const a = await env.widgetVisitor(env.a);
  const b = await env.widgetVisitor(env.b);
  return {
    ...a,
    key: await keyFor(env.a, a.customerId, "customer_file"),
    foreignKey: await keyFor(env.b, b.customerId, "customer_file"),
  };
}

/** The files rows that registered the valid caller's upload: no other caller may add one. */
const registered = (env: ContractEnv, ids: { key: string }) =>
  env.scoped(env.a, (db) =>
    db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.storageKey, ids.key)),
  );
/** Customer A's avatar key. */
const avatarOf = (env: ContractEnv, ids: { customerId: string }) =>
  env.scoped(env.a, (db) =>
    db
      .select({ imageKey: customer.imageKey })
      .from(customer)
      .where(eq(customer.id, ids.customerId as CustomerId)),
  );

export const createQuillsPortalUpload = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    return env.portalCustomer(env.a, env.customerA);
  },
  valid: () => ({ body: request("customer_image") }),
  // The key names the customer: customer B's or a teammate's answer must not.
  own: (ids) => [ids.customerId],
});

export const createQuillsPortalFiles = fixture({
  seed: (env) => portalUploads(env, "customer_image"),
  valid: (ids) => ({ body: { key: ids.key, name: "image.png", ...image } }),
  foreign: (ids) => ({ key: ids.foreignKey }),
  own: (ids) => [ids.key],
  probe: registered,
});

export const createQuillsWidgetUpload = fixture({
  seed: (env) => env.widgetVisitor(env.a),
  valid: (ids) => ({ bearer: ids.token, body: request("customer_file") }),
  own: (ids) => [ids.customerId],
});

export const createQuillsWidgetFiles = fixture({
  seed: widgetUploads,
  valid: (ids) => ({
    bearer: ids.token,
    body: { key: ids.key, name: "image.png", ...image },
  }),
  foreign: (ids) => ({ key: ids.foreignKey }),
  own: (ids) => [ids.key],
  probe: registered,
});

export const saveQuillsCustomerAvatar = fixture({
  seed: (env) => portalUploads(env, "customer_avatar"),
  valid: (ids) => ({ body: { key: ids.key, ...image } }),
  foreign: (ids) => ({ key: ids.foreignKey }),
  own: (ids) => [ids.principalId, ids.key],
  probe: avatarOf,
});

export const deleteQuillsCustomerAvatar = fixture({
  seed: async (env) => {
    const ids = await portalUploads(env, "customer_avatar");
    await env.scoped(env.a, (db) =>
      db
        .update(customer)
        .set({ imageKey: ids.key })
        .where(eq(customer.id, ids.customerId as CustomerId)),
    );
    return ids;
  },
  valid: () => ({}),
  own: (ids) => [ids.principalId],
  probe: avatarOf,
});

export const prepareQuillsPortalUpload = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    return {};
  },
  valid: () => ({}),
  probe: (env) =>
    env.scoped(env.a, (db) =>
      db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.kaneoUserId, env.customerA)),
    ),
});
