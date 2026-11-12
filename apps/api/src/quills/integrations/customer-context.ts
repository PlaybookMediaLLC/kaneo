import { and, asc, eq, inArray } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { integrations } from "../../database/quills/schema/integrations";
import { loadCustomer, realEmail } from "../directory/customer";
import { defineQuillsRoute } from "../framework/define-route";
import {
  ProviderCallError,
  openCredentials,
  providerJson,
} from "../framework/integration-config";
import {
  boundContact,
  contactView,
  lookupEmail,
  lookupLimits,
} from "./contacts";
import { appCredentials, keepRefreshed, withToken } from "./oauth";
import {
  form,
  record,
  rows,
  text,
  type OAuthProvider,
} from "./oauth-providers";
import { oauthProvider, oauthProviders } from "./providers";

// Customer context: one lookup of a customer's email in each connected provider that has one. A
// provider that fails gives a fixed error text, and the others still answer. The provider calls run
// with no database transaction open: prepare reads, call looks up, the handler keeps refreshed tokens.
// The providers run at once. Each one stops at its own budget or at the read's deadline, whichever
// comes first (lookupLimits in contacts.ts), and the read answers with the providers that finished.

type Lookup = NonNullable<OAuthProvider["contact"]>;

const freshdeskHost = /^[a-z0-9-]{1,63}\.freshdesk\.com$/;
/** Freshdesk: the help desk host is the connection's account label, checked again before the call. */
const freshdesk: Lookup = async (secrets, config, email, signal) => {
  const host = text(config.account);
  if (!freshdeskHost.test(host)) throw new ProviderCallError(401);
  const [found] = rows(
    await providerJson(
      `https://${host}/api/v2/contacts?${form({ email })}`,
      {
        headers: {
          authorization: `Basic ${btoa(`${secrets.apiKey ?? ""}:X`)}`,
          accept: "application/json",
        },
        signal,
      },
      freshdeskHost,
    ),
  ).map(record);
  if (!found || !Number.isSafeInteger(found.id) || Number(found.id) <= 0)
    return null;
  const title = text(found.job_title);
  return {
    name: text(found.name) || null,
    company: null,
    url: `https://${host}/a/contacts/${String(found.id)}`,
    fields: title ? [{ label: "Job title", value: title }] : [],
  };
};

/** Stripe: the first customer with this email. */
const stripe: Lookup = async (secrets, _config, email, signal) => {
  const [found] = rows(
    record(
      await providerJson(
        `https://api.stripe.com/v1/customers?${form({ email, limit: "1" })}`,
        {
          headers: { authorization: `Bearer ${secrets.apiKey ?? ""}` },
          signal,
        },
        /^api\.stripe\.com$/,
      ),
    ).data,
  ).map(record);
  const id = text(found?.id);
  if (!found || !/^cus_[A-Za-z0-9]{1,64}$/.test(id)) return null;
  return {
    name: text(found.name) || null,
    company: null,
    url: `https://dashboard.stripe.com/customers/${id}`,
    fields: [{ label: "Customer ID", value: id }],
  };
};

/** The key-connected providers with a lookup. Their saved key reads the customer record. */
const keyLookups: Record<string, Lookup> = { freshdesk, stripe };
/** Every integration type with a lookup. A workspace has one connection per type, so at most this many. */
const contextTypes = [
  ...Object.keys(oauthProviders).filter((type) => oauthProvider(type)?.contact),
  ...Object.keys(keyLookups),
];

type Prepared = {
  type: string;
  connection: Parameters<typeof keepRefreshed>[1];
  config: Record<string, unknown>;
  secrets: Record<string, string> | undefined;
  creds: Record<string, string>;
};

/**
 * One provider's entry. Errors are fixed texts: provider text never reaches the response. When
 * `signal` aborts, the entry is `failed` at once, with a refresh that finished before it.
 */
async function lookup(prepared: Prepared, email: string, signal: AbortSignal) {
  const entry = {
    integrationType: prepared.type,
    connection: prepared.connection,
    refreshed: null as Record<string, string> | null,
  };
  const failed = (error: string) => ({
    ...entry,
    status: "failed" as const,
    error,
    contact: null,
  });
  if (!prepared.secrets)
    return failed("The saved credentials cannot be read. Reconnect.");
  const contact =
    oauthProvider(prepared.type)?.contact ?? keyLookups[prepared.type]!;
  try {
    const { data, refreshed, failure } = await withToken(
      { type: prepared.type, secrets: prepared.secrets, creds: prepared.creds },
      (secrets) => contact(secrets, prepared.config, email, signal),
      signal,
    );
    if (failure) return { ...failed(failure.message), refreshed };
    return {
      ...entry,
      refreshed,
      status: data ? ("found" as const) : ("not_found" as const),
      error: null,
      contact: data && boundContact(data),
    };
  } catch {
    // Not a provider answer (for example a host the provider may not call).
    return failed("The provider lookup failed.");
  }
}

const customerContext = defineQuillsRoute({
  method: "get",
  path: "/people/{principalId}/context",
  operationId: "getQuillsCustomerContext",
  summary: "Look up a customer in the connected CRM and support tools",
  description:
    "Sends the customer's email to each connected provider with a contact lookup (HubSpot, Intercom, Zendesk, Salesforce, Freshdesk, Stripe) and returns one entry for each, with selected fields only. A provider that fails, or does not answer in time, gives `failed` and a fixed error text; the others still answer. A customer without an email address gives no entries. Calls the providers.",
  // The lookup sends a customer's email to the connected accounts and returns their records: viewers may not.
  action: "update",
  params: z.object({ principalId: flexibleToTypeIdSchema("principal") }),
  response: z.object({
    providers: z.array(
      z.object({
        integrationId: z.string(),
        integrationType: z.string(),
        status: z.enum(["found", "not_found", "failed"]),
        error: z.string().nullable(),
        contact: contactView.nullable(),
      }),
    ),
  }),
  responseDescription: "One entry for each connected provider with a lookup",
  errors: { 403: "Insufficient permission", 404: "Person not found" },
  prepare: async ({ db, params }) => {
    // The read's deadline starts here, so that it also covers this database read.
    const deadline = AbortSignal.timeout(lookupLimits.context);
    // A customer of this workspace only: a teammate, a foreign or a removed person is 404.
    const person = await loadCustomer(db, params.principalId);
    const email = lookupEmail.safeParse(
      realEmail(person.email) ?? realEmail(person.contactEmail),
    );
    if (!email.success)
      return { email: "", providers: [] as Prepared[], deadline };
    const rows = await db
      .select({
        id: integrations.id,
        integrationType: integrations.integrationType,
        config: integrations.config,
        connectedAt: integrations.connectedAt,
        secrets: integrations.secrets,
      })
      .from(integrations)
      .where(
        and(
          eq(integrations.status, "active"),
          inArray(integrations.integrationType, contextTypes),
        ),
      )
      .orderBy(asc(integrations.integrationType));
    const providers: Prepared[] = [];
    for (const row of rows)
      providers.push({
        type: row.integrationType,
        connection: {
          id: row.id,
          connectedAt: row.connectedAt?.toISOString() ?? null,
        },
        config: row.config,
        secrets: openCredentials(row.secrets),
        creds:
          (oauthProvider(row.integrationType) &&
            (await appCredentials(db, row.integrationType))) ||
          {},
      });
    return { email: email.data, providers, deadline };
  },
  call: ({ email, providers, deadline }) =>
    Promise.all(
      providers.map((prepared) =>
        lookup(
          prepared,
          email,
          AbortSignal.any([
            deadline,
            AbortSignal.timeout(lookupLimits.provider),
          ]),
        ),
      ),
    ),
  handler: async ({ db, called }) => {
    for (const one of called)
      await keepRefreshed(db, one.connection, one.refreshed);
    return {
      providers: called.map(({ connection, refreshed: _, ...entry }) => ({
        integrationId: connection.id,
        ...entry,
      })),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...customerContext,
);
