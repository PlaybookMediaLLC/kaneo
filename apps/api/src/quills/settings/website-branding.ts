import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { files } from "../../database/quills/schema/files";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import {
  holdVerifiedUpload,
  imageUrl,
  isQuillsStorageConfigured,
} from "../framework/files";
import {
  isMemberOfNamedWorkspace,
  portalAccount,
} from "../framework/platform-reads";
import { parseBag } from "../feedback/settings-json";
import {
  companyEmailDomain,
  fetchWebsiteBranding,
  parseWebsiteInput,
  storeLogo,
} from "./website-fetch";

// Website branding: a lookup reads a company website and keeps its logo and color as an offer.
// Accept applies them, decline drops them, undo restores the previous values. The boundary map,
// the storage lifecycle and the differences from the source are in WEBSITE-BRANDING.md.

type Row = typeof settings.$inferSelect;
/** The lookup state, in settings.metadata under this key (the source's key). */
const KEY = "brandingLookup";
/** An applied logo shows with Undo for this long. */
const NOTICE_MS = 3 * 86_400_000;
/** `start` runs only this long after Kaneo initialized Quills for the workspace. */
const FIRST_RUN_MS = 14 * 86_400_000;

const stored = z.object({
  version: z.literal(1),
  status: z.enum([
    "offered",
    "applied",
    "declined",
    "undone",
    "skipped",
    "failed",
  ]),
  domain: z.string().min(1).max(253),
  completedAt: z.iso.datetime(),
  offer: z
    .object({
      logoKey: z.string().min(1).max(1024),
      color: z
        .string()
        .regex(/^#[0-9A-F]{6}$/)
        .nullable(),
    })
    .optional(),
  /**
   * The values before and after accept. Undo writes `before` back while the row holds `after`. Accept
   * runs only with no logo, so undo never writes a stored key back.
   */
  receipt: z
    .object({
      logoKey: z.object({ before: z.null(), after: z.string() }),
      brandingConfig: z
        .object({ before: z.string().nullable(), after: z.string() })
        .optional(),
    })
    .optional(),
});
type Lookup = z.output<typeof stored>;

const branding = z
  .object({
    domain: z.string(),
    status: z.enum(["eligible", ...stored.shape.status.options]),
    logoUrl: z.string().nullable().openapi({
      description:
        "A short-lived URL of the logo, while it is offered or applied",
    }),
    colorApplied: z.boolean(),
    canUndo: z.boolean(),
    canUse: z.boolean(),
  })
  .openapi("QuillsWebsiteBranding");
type Branding = z.input<typeof branding>;
/** `branding` is null when there is nothing to show. */
const response = z.object({ branding: branding.nullable() });

const unavailable = () =>
  new HTTPException(409, {
    message: "This branding change is no longer available.",
  });

const readRow = async (db: Database, lock = false) => {
  const query = db.select().from(settings).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new Error("Quills settings were not initialized");
  return row;
};

/**
 * `attempted`: the key exists, so `start` never runs again (also for a value this code cannot read).
 * Metadata that is not a JSON object also counts: no lookup result could be saved there.
 */
function readLookup(row: Row) {
  const bag = parseBag(row.metadata);
  const parsed = stored.safeParse(bag?.[KEY]);
  return {
    attempted: !bag || Object.hasOwn(bag, KEY),
    lookup: parsed.success ? parsed.data : null,
  };
}

const malformed = () =>
  new HTTPException(409, {
    message: "Stored settings are not a JSON object; they were left unchanged",
  });

/** Writes the lookup, and the column values, in one update of the locked row. */
async function save(
  db: Database,
  row: Row,
  lookup: Lookup,
  columns: Partial<Pick<Row, "logoKey" | "brandingConfig">> = {},
) {
  const bag = parseBag(row.metadata);
  if (!bag) throw malformed();
  const [updated] = await db
    .update(settings)
    .set({
      ...columns,
      metadata: JSON.stringify({ ...bag, [KEY]: stored.parse(lookup) }),
    })
    .where(eq(settings.id, row.id))
    .returning();
  return updated!;
}

const startable = (row: Row) =>
  isQuillsStorageConfigured() &&
  Date.now() - row.createdAt.getTime() <= FIRST_RUN_MS;

/** Undo needs both columns to hold the applied values still. */
const stillApplied = ({ receipt }: Lookup, row: Row) =>
  Boolean(
    receipt &&
    row.logoKey === receipt.logoKey.after &&
    (!receipt.brandingConfig ||
      row.brandingConfig === receipt.brandingConfig.after),
  );

const quiet = (domain: string, status: Branding["status"]): Branding => ({
  domain,
  status,
  logoUrl: null,
  colorApplied: false,
  canUndo: false,
  canUse: false,
});

/**
 * What the caller sees for a recorded lookup, or null when there is nothing to show: an offer that a
 * logo set by hand answered, or an applied change that was edited since or is older than the notice.
 */
async function present(
  row: Row,
  lookup: Lookup | null,
): Promise<Branding | null> {
  if (!lookup) return null;
  if (lookup.status === "offered")
    return row.logoKey || !lookup.offer
      ? null
      : {
          ...quiet(lookup.domain, "offered"),
          logoUrl: await imageUrl(lookup.offer.logoKey),
          canUse: true,
        };
  if (lookup.status === "applied")
    return Date.now() - Date.parse(lookup.completedAt) >= NOTICE_MS ||
      !stillApplied(lookup, row)
      ? null
      : {
          ...quiet(lookup.domain, "applied"),
          logoUrl: row.logoKey && (await imageUrl(row.logoKey)),
          colorApplied: Boolean(lookup.receipt?.brandingConfig),
          // The route's action, manage_settings, covers every field that undo writes.
          canUndo: true,
        };
  return quiet(lookup.domain, lookup.status);
}

type Found = Awaited<ReturnType<typeof storeLogo>> & { color: string | null };

// ponytail: an in-process cap, one lookup for each workspace and at most 4 on each API instance. A
// cap across instances needs a lease row.
const MAX_LOOKUPS = 4;
const running = new Set<string>();

/**
 * Reads the site and stores its logo, with no transaction open. Null when nothing was stored. A
 * result that is not `verified` must be released.
 */
async function find(workspaceId: string, site: URL): Promise<Found | null> {
  if (running.has(workspaceId) || running.size >= MAX_LOOKUPS)
    throw new HTTPException(409, {
      message: "A website lookup is already running. Try again soon.",
    });
  running.add(workspaceId);
  try {
    const logo = await fetchWebsiteBranding(site);
    return (
      logo && { ...(await storeLogo(workspaceId, logo)), color: logo.color }
    );
  } catch (error) {
    // Storage refused the upload before any object was written.
    console.warn(
      "Website branding: the logo was not stored:",
      (error as Error).message,
    );
    return null;
  } finally {
    running.delete(workspaceId);
  }
}

const fileRow = (actor: QuillsActor, found: Found) => ({
  storageKey: found.key,
  name: "website-logo",
  contentType: found.contentType,
  family: "image",
  size: found.size,
  sha256: found.sha256,
  source: "agent",
  uploadedById: actor.principalId,
  previewStatus: "none",
});

/**
 * Lets a stored logo go that no lookup keeps. No column holds its key, so a files row that lives only
 * in this transaction makes the storage trigger queue the key for cleanup.
 */
async function release(db: Database, actor: QuillsActor, found: Found) {
  await db.insert(files).values(fileRow(actor, found));
  await db.delete(files).where(eq(files.storageKey, found.key));
}

/** Deletes the files row of an offer that is not kept. The storage trigger queues its key. */
async function dropOffer(db: Database, lookup: Lookup | null) {
  if (lookup?.status === "offered" && lookup.offer)
    await db.delete(files).where(eq(files.storageKey, lookup.offer.logoKey));
}

/** Records a finished lookup on the locked row. A logo on the row wins over the website's. */
async function record(
  db: Database,
  actor: QuillsActor,
  row: Row,
  domain: string,
  found: Found | null,
  skipped: boolean,
) {
  const previous = readLookup(row).lookup;
  // An accept that committed during the fetch keeps its state and its undo receipt.
  if (row.logoKey && previous?.status === "applied") {
    if (found) await release(db, actor, found);
    return present(row, previous);
  }
  const status =
    row.logoKey || skipped ? "skipped" : found?.verified ? "offered" : "failed";
  await dropOffer(db, previous);
  if (found && status !== "offered") await release(db, actor, found);
  if (found && status === "offered") {
    // Row lock first, then the object lock: the order of the storage trigger.
    await holdVerifiedUpload(db, found);
    await db.insert(files).values(fileRow(actor, found));
  }
  const lookup: Lookup = {
    version: 1,
    status,
    domain,
    completedAt: new Date().toISOString(),
    ...(found &&
      status === "offered" && {
        offer: { logoKey: found.key, color: found.color },
      }),
  };
  return present(await save(db, row, lookup), lookup);
}

/** The caller's company email domain. Null for a personal address or a caller who is not a member. */
async function callerDomain({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  // isMemberOfNamedWorkspace, not portalAccount's `member` flag: it also requires an unarchived workspace.
  const [account, member] = await Promise.all([
    portalAccount(workspaceId, userId),
    isMemberOfNamedWorkspace(workspaceId, userId),
  ]);
  return account && member ? companyEmailDomain(account.email) : null;
}

const started = (
  workspaceId: string,
  source: "site" | "email",
  result: { branding: Branding | null },
) => ({
  type: "branding.auto_started" as const,
  entityType: "settings" as const,
  entityId: workspaceId,
  payload: { source, status: result.branding?.status ?? "none" },
});

const status = defineQuillsRoute({
  method: "get",
  path: "/settings/website-branding",
  operationId: "getQuillsAutomaticWebsiteBrandingStatus",
  summary: "Get the website branding status",
  description:
    "`eligible` when no lookup has run and `start` would run for the caller.",
  action: "manage_settings",
  response,
  responseDescription: "The website branding status",
  load: callerDomain,
  handler: async ({ db, loaded }) => {
    const row = await readRow(db);
    const { attempted, lookup } = readLookup(row);
    if (attempted) return { branding: await present(row, lookup) };
    return {
      branding: loaded && startable(row) ? quiet(loaded, "eligible") : null,
    };
  },
});

const lookup = defineQuillsRoute({
  method: "post",
  path: "/settings/website-branding/lookup",
  operationId: "lookupQuillsWebsiteBranding",
  summary: "Look up the branding of a website",
  description:
    "Reads the home page of the website through the public-destination guard and keeps its logo as an offer. Nothing is applied. Replaces an earlier lookup while the workspace has no logo.",
  action: "manage_settings",
  body: z.object({
    site: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .openapi({ description: "A domain or a URL", example: "acme.com" }),
  }),
  response,
  responseDescription: "The recorded lookup",
  errors: {
    400: "Not a website address",
    409: "The workspace has a logo, file storage is not configured, or a lookup is running",
  },
  prepare: async ({ db, body }) => {
    const site = parseWebsiteInput(body.site);
    if (!site)
      throw new HTTPException(400, {
        message: "Enter a website, like acme.com.",
      });
    const row = await readRow(db);
    if (!parseBag(row.metadata)) throw malformed();
    if (!isQuillsStorageConfigured() || row.logoKey) throw unavailable();
    return site;
  },
  call: async (site, { workspaceId }) => ({
    domain: site.hostname.toLowerCase(),
    found: await find(workspaceId, site),
  }),
  event: ({ workspaceId }, result) => started(workspaceId, "site", result),
  handler: async ({ db, actor, called }) => ({
    branding: await record(
      db,
      actor,
      await readRow(db, true),
      called.domain,
      called.found,
      false,
    ),
  }),
});

const start = defineQuillsRoute({
  method: "post",
  path: "/settings/website-branding/start",
  operationId: "startQuillsAutomaticWebsiteBranding",
  summary: "Look up the caller's company website once",
  description:
    "Uses the domain of the caller's work email. Runs once for each workspace, in the first 14 days after Quills was set up, and only while file storage is configured. A workspace with a logo records the lookup as skipped.",
  action: "manage_settings",
  response: response.extend({
    started: z.boolean().openapi({
      description: "Whether this request recorded the lookup",
    }),
  }),
  responseDescription: "The recorded lookup",
  errors: { 409: "A lookup is running" },
  load: callerDomain,
  prepare: async ({ db, loaded }) => {
    const row = await readRow(db);
    if (!loaded || readLookup(row).attempted || !startable(row)) return null;
    return { domain: loaded, skipped: Boolean(row.logoKey) };
  },
  call: async (plan, { workspaceId }) =>
    plan && {
      ...plan,
      found: plan.skipped
        ? null
        : await find(workspaceId, new URL(`https://${plan.domain}`)),
    },
  event: ({ workspaceId }, result) =>
    result.started && started(workspaceId, "email", result),
  handler: async ({ db, actor, called }) => {
    // Lock only when this request has a result to write.
    const row = await readRow(db, Boolean(called));
    const { attempted, lookup } = readLookup(row);
    if (called && !attempted)
      return {
        started: true,
        branding: await record(
          db,
          actor,
          row,
          called.domain,
          called.found,
          called.skipped,
        ),
      };
    // Another request recorded the lookup during the fetch: its result stays.
    if (called?.found) await release(db, actor, called.found);
    return {
      started: false,
      branding: attempted ? await present(row, lookup) : null,
    };
  },
});

/** No custom CSS, no preset and no colors: any other theme is the administrator's choice and stays. */
function defaultTheme(row: Row) {
  if (row.customCss?.trim()) return false;
  if (!row.brandingConfig?.trim()) return true;
  const config = parseBag(row.brandingConfig);
  const empty = (value: unknown) =>
    value === undefined ||
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0);
  return Boolean(
    config &&
    Object.keys(config).every((key) =>
      ["themeMode", "light", "dark"].includes(key),
    ) &&
    empty(config.light) &&
    empty(config.dark),
  );
}

const accept = defineQuillsRoute({
  method: "post",
  path: "/settings/website-branding/accept",
  operationId: "acceptQuillsWebsiteBrandingOffer",
  summary: "Use the offered website logo",
  description:
    "Sets the offered logo. Its color also becomes the primary color when the theme is still the default. Undo restores the previous values.",
  action: "manage_settings",
  response,
  responseDescription: "The applied branding",
  errors: { 409: "No offer is waiting, or the workspace has a logo" },
  event: ({ workspaceId }, result) => ({
    type: "branding.offer_accepted",
    entityType: "settings",
    entityId: workspaceId,
    payload: { colorApplied: String(result.branding?.colorApplied ?? false) },
  }),
  handler: async ({ db }) => {
    const row = await readRow(db, true);
    const { lookup } = readLookup(row);
    const offer = lookup?.status === "offered" ? lookup.offer : undefined;
    if (!lookup || !offer || row.logoKey) throw unavailable();
    // The files row held the key while it was an offer. From now on logo_key holds it.
    const held = await db
      .delete(files)
      .where(eq(files.storageKey, offer.logoKey))
      .returning({ id: files.id });
    if (!held.length) throw unavailable();
    const theme =
      offer.color && defaultTheme(row)
        ? JSON.stringify({
            ...parseBag(row.brandingConfig),
            light: { primary: offer.color },
            dark: { primary: offer.color },
          })
        : null;
    const next: Lookup = {
      ...lookup,
      status: "applied",
      completedAt: new Date().toISOString(),
      receipt: {
        logoKey: { before: null, after: offer.logoKey },
        ...(theme && {
          brandingConfig: { before: row.brandingConfig, after: theme },
        }),
      },
    };
    const updated = await save(db, row, next, {
      logoKey: offer.logoKey,
      ...(theme && { brandingConfig: theme }),
    });
    return { branding: await present(updated, next) };
  },
});

const decline = defineQuillsRoute({
  method: "post",
  path: "/settings/website-branding/decline",
  operationId: "declineQuillsWebsiteBrandingOffer",
  summary: "Decline the offered website logo",
  description: "Drops the offer. The stored logo is queued for cleanup.",
  action: "manage_settings",
  response,
  responseDescription: "The declined lookup",
  errors: { 409: "No offer is waiting" },
  event: ({ workspaceId }) => ({
    type: "branding.offer_declined",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db }) => {
    const row = await readRow(db, true);
    const { lookup } = readLookup(row);
    if (lookup?.status !== "offered") throw unavailable();
    await dropOffer(db, lookup);
    const next: Lookup = {
      ...lookup,
      status: "declined",
      completedAt: new Date().toISOString(),
    };
    return { branding: await present(await save(db, row, next), next) };
  },
});

const undo = defineQuillsRoute({
  method: "post",
  path: "/settings/website-branding/undo",
  operationId: "undoQuillsAutomaticWebsiteBranding",
  summary: "Undo the applied website branding",
  description:
    "Restores the logo and theme values from before accept, when neither changed since. The website logo is queued for cleanup.",
  action: "manage_settings",
  response,
  responseDescription: "The undone lookup",
  errors: {
    409: "Nothing to undo, or the branding changed since it was applied",
  },
  event: ({ workspaceId }) => ({
    type: "branding.auto_undone",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db }) => {
    const row = await readRow(db, true);
    const { lookup } = readLookup(row);
    const receipt = lookup?.status === "applied" ? lookup.receipt : undefined;
    if (!lookup || !receipt) throw unavailable();
    if (!stillApplied(lookup, row))
      throw new HTTPException(409, {
        message: "The branding changed since then. Undo is unavailable.",
      });
    const next: Lookup = {
      ...lookup,
      status: "undone",
      completedAt: new Date().toISOString(),
    };
    const updated = await save(db, row, next, {
      logoKey: null,
      ...(receipt.brandingConfig && {
        brandingConfig: receipt.brandingConfig.before,
      }),
    });
    return { branding: await present(updated, next) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...status)
  .openapi(...lookup)
  .openapi(...start)
  .openapi(...accept)
  .openapi(...decline)
  .openapi(...undo);
