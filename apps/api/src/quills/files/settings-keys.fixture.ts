import { settings } from "../../database/quills/schema/auth";
import { fixture, type ContractEnv } from "../framework/contract";
import { image, uploads } from "./seed.fixture";
import { fields } from "./settings-keys";

type Purpose = keyof typeof fields;

const save = (purpose: Purpose) =>
  fixture({
    seed: (env) => uploads(env, purpose),
    valid: ({ a }) => ({ body: { key: a, ...image } }),
    foreign: ({ b }) => ({ key: b }),
  });

/** A key already set in both workspaces, so the delete changes a row. */
const remove = (purpose: Purpose) =>
  fixture({
    seed: async (env: ContractEnv) => {
      const keys = await uploads(env, purpose);
      for (const workspaceId of [env.a, env.b])
        await env.scoped(workspaceId, (db) =>
          db.update(settings).set({
            [fields[purpose].property]: workspaceId === env.a ? keys.a : keys.b,
          }),
        );
    },
    valid: () => ({}),
  });

export const saveQuillsLogoKey = save("logo");
export const deleteQuillsLogo = remove("logo");
export const saveQuillsFaviconKey = save("favicon");
export const deleteQuillsFavicon = remove("favicon");
export const saveQuillsHeaderLogoKey = save("header_logo");
export const deleteQuillsHeaderLogo = remove("header_logo");
export const saveQuillsWidgetHeroImageKey = save("widget_hero");
export const deleteQuillsWidgetHeroImage = remove("widget_hero");
