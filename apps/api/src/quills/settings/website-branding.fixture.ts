import { settings } from "../../database/quills/schema/auth";
import { files } from "../../database/quills/schema/files";
import { fixture, type ContractEnv } from "../framework/contract";

// Lookup states in workspace A. No fixture fetches a site: lookup uses a loopback site, which the
// guard refuses before any request, and start finds a logo, so it records `skipped` with no fetch.

const color = "#2563EB";
const theme = JSON.stringify({
  light: { primary: color },
  dark: { primary: color },
});

/** Replaces the brandingLookup key of A's settings metadata (undefined removes it) and sets columns. */
const setState = (
  env: ContractEnv,
  state: (key: string) => Record<string, unknown> | undefined,
  columns: (key: string) => {
    logoKey: string | null;
    brandingConfig?: string | null;
  },
  file = false,
) =>
  env.scoped(env.a, async (db, actor) => {
    const key = `workspace/${env.a}/quills/logo/${env.id("logo")}.png`;
    if (file)
      await db.insert(files).values({
        storageKey: key,
        name: "website-logo",
        contentType: "image/png",
        family: "image",
        size: 1024,
        sha256: "0".repeat(64),
        source: "agent",
        uploadedById: actor.principalId,
        previewStatus: "none",
      });
    const [row] = await db
      .select({ metadata: settings.metadata })
      .from(settings);
    const { brandingLookup: _, ...rest } = JSON.parse(row?.metadata || "{}");
    const lookup = state(key);
    await db.update(settings).set({
      ...columns(key),
      metadata: JSON.stringify(
        lookup ? { ...rest, brandingLookup: lookup } : rest,
      ),
    });
    return { key };
  });

const lookup = (status: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  status,
  domain: "acme.example",
  completedAt: new Date().toISOString(),
  ...extra,
});
const offered = (env: ContractEnv) =>
  setState(
    env,
    (key) => lookup("offered", { offer: { logoKey: key, color } }),
    () => ({ logoKey: null, brandingConfig: null }),
    true,
  );

export const getQuillsAutomaticWebsiteBrandingStatus = fixture({
  seed: offered,
  valid: () => ({}),
});
export const lookupQuillsWebsiteBranding = fixture({
  seed: (env) =>
    setState(
      env,
      () => undefined,
      () => ({ logoKey: null }),
    ),
  valid: () => ({ body: { site: "localhost" } }),
});
export const startQuillsAutomaticWebsiteBranding = fixture({
  seed: (env) =>
    setState(
      env,
      () => undefined,
      (key) => ({ logoKey: key }),
    ),
  valid: () => ({}),
});
export const acceptQuillsWebsiteBrandingOffer = fixture({
  seed: offered,
  valid: () => ({}),
});
export const declineQuillsWebsiteBrandingOffer = fixture({
  seed: offered,
  valid: () => ({}),
});
export const undoQuillsAutomaticWebsiteBranding = fixture({
  seed: (env) =>
    setState(
      env,
      (key) =>
        lookup("applied", {
          offer: { logoKey: key, color },
          receipt: {
            logoKey: { before: null, after: key },
            brandingConfig: { before: null, after: theme },
          },
        }),
      (key) => ({ logoKey: key, brandingConfig: theme }),
    ),
  valid: () => ({}),
});
