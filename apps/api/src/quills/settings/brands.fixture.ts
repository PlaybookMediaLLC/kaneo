import { brands } from "../../database/quills/schema/brands";
import { empty, fixture, type ContractEnv } from "../framework/contract";

async function seedBrand(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db) => {
    const slug = `brand-${env.id("brand").slice(-8).toLowerCase()}`;
    const [row] = await db
      .insert(brands)
      .values({ name: "Contract Brand", slug })
      .returning({ id: brands.id });
    return row!.id;
  });
}

const seed = async (env: ContractEnv) => ({
  a: await seedBrand(env, env.a),
  b: await seedBrand(env, env.b),
});

export const listQuillsBrands = empty;
export const createQuillsBrand = fixture({
  seed: async (env) => ({
    slug: `new-${env.id("brand").slice(-8).toLowerCase()}`,
  }),
  valid: ({ slug }) => ({ body: { name: "Acme", slug } }),
});
export const updateQuillsBrand = fixture({
  seed,
  valid: ({ a }) => ({ params: { brandId: a }, body: { name: "Acme v2" } }),
  foreign: ({ b }) => ({ brandId: b }),
});
export const deleteQuillsBrand = fixture({
  seed,
  valid: ({ a }) => ({ params: { brandId: a } }),
  foreign: ({ b }) => ({ brandId: b }),
});
export const listQuillsEmailTemplates = fixture({
  seed,
  valid: ({ a }) => ({ params: { brandId: a } }),
  foreign: ({ b }) => ({ brandId: b }),
});
export const upsertQuillsEmailTemplate = fixture({
  seed,
  valid: ({ a }) => ({
    params: { brandId: a, templateKey: "conversation_reply" },
    body: {
      locale: "en",
      subject: "Hello {{customerName}}",
      mode: "blocks",
      blocksJson: [{ id: "b1", type: "text", content: "Hi!" }],
    },
  }),
  foreign: ({ b }) => ({ brandId: b, templateKey: "conversation_reply" }),
});
export const previewQuillsEmailTemplate = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      subject: "Preview {{subject}}",
      mode: "blocks",
      blocksJson: [{ id: "b1", type: "text", content: "Body" }],
      variables: { subject: "Test" },
    },
  }),
});
export const sendQuillsTestEmail = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      to: "preview@example.com",
      subject: "Test email",
      mode: "blocks",
      blocksJson: [{ id: "b1", type: "text", content: "Hello" }],
    },
  }),
});
