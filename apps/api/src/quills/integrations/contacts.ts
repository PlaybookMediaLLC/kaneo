import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { integrationParams } from "./connect";
import { keepRefreshed, oauthConnection, withToken } from "./oauth";
import type { Contact } from "./oauth-providers";
import { oauthProvider } from "./providers";

// CRM contact lookup by email through a connection's `contact` capability (HubSpot, Intercom,
// Zendesk, Salesforce). The provider call runs with no database transaction open.

/** A CRM record as a response returns it: selected fields, each one bounded. */
export const contactView = z
  .object({
    name: z.string().nullable(),
    company: z.string().nullable(),
    /** The record in the provider's own tool. */
    url: z.string().nullable(),
    fields: z.array(z.object({ label: z.string(), value: z.string() })),
  })
  .openapi("QuillsCrmContact");

const clip = (value: string | null, max: number) =>
  value?.trim().slice(0, max) || null;
/** Selects and bounds the fields of a provider's contact: at most 10 fields, short texts, an HTTPS link. */
export const boundContact = (
  contact: Contact,
): z.input<typeof contactView> => ({
  name: clip(contact.name, 200),
  company: clip(contact.company, 200),
  url:
    contact.url?.startsWith("https://") && contact.url.length <= 2048
      ? contact.url
      : null,
  fields: contact.fields.slice(0, 10).flatMap((field) => {
    const label = clip(field.label, 50);
    const value = clip(field.value, 500);
    return label && value ? [{ label, value }] : [];
  }),
});

/** An email address to look up. The same bounds as the people directory. */
export const lookupEmail = z.string().trim().email().max(254);

/**
 * The time limits of a lookup, in milliseconds. Tests shorten them.
 * - `provider`: one provider's whole chain (a token refresh, the lookup and its follow-up reads, up
 *   to four requests for HubSpot). A healthy provider answers each one in well under a second.
 * - `context`: a customer context read, from its start. Its providers run at once, so this is the
 *   provider budget plus 2 seconds for the read's own database work.
 */
export const lookupLimits = { provider: 8_000, context: 10_000 };

const searchContact = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}/contacts",
  operationId: "searchQuillsIntegrationContact",
  summary: "Look up a contact by email in a CRM connection",
  description:
    "Sends the email to the connected provider and returns its first matching record, with selected fields only. Calls the provider. Only for an OAuth connection with contact lookup (HubSpot, Intercom, Zendesk, Salesforce): another OAuth connection gives 409, and a connection that is not OAuth gives 404. The customer context reads Freshdesk and Stripe.",
  // The lookup sends an email to the connected account and returns its records: viewers may not.
  action: "update",
  params: integrationParams,
  query: z.object({ email: lookupEmail }),
  response: z.object({ contact: contactView.nullable() }),
  responseDescription: "The matching contact, or null",
  errors: {
    403: "Insufficient permission",
    404: "Integration not found, or not an OAuth connection",
    409: "Reconnect the integration, or it has no contact lookup",
    502: "The provider could not be reached or did not answer in time",
  },
  prepare: async ({ db, params }) => {
    const { row, provider, secrets, creds } = await oauthConnection(
      db,
      params.integrationId,
    );
    if (!provider.contact)
      throw new HTTPException(409, {
        message: "This integration has no contact lookup.",
      });
    return {
      type: row.integrationType,
      connection: {
        id: row.id,
        connectedAt: row.connectedAt?.toISOString() ?? null,
      },
      secrets,
      creds,
      config: row.config,
    };
  },
  call: async (prepared, { query }) => {
    const signal = AbortSignal.timeout(lookupLimits.provider);
    return {
      connection: prepared.connection,
      ...(await withToken(
        prepared,
        (secrets) =>
          oauthProvider(prepared.type)!.contact!(
            secrets,
            prepared.config,
            query.email,
            signal,
          ),
        signal,
      )),
    };
  },
  failure: (called) => called.failure,
  handler: async ({ db, called }) => {
    await keepRefreshed(db, called.connection, called.refreshed);
    return { contact: called.data ? boundContact(called.data) : null };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...searchContact,
);
