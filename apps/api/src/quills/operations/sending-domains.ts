import { and, asc, eq, isNull } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  channelAccounts,
  emailSendingDomains,
} from "../../database/quills/schema/channel-accounts";
import { defineQuillsRoute } from "../framework/define-route";

// The sending domains of the Domains settings page, with the addresses that send from each.
// Setup (DNS records, checks) stays with the support channel routes.

const localPart = (address: string) => {
  const at = address.lastIndexOf("@");
  return at > 0 ? `${address.slice(0, at).toLowerCase()}@` : null;
};

const list = defineQuillsRoute({
  method: "get",
  path: "/operations/domains/sending",
  operationId: "listQuillsSendingDomains",
  summary: "List the email sending domains",
  action: "manage_settings",
  response: z.object({
    domains: z.array(
      z.object({
        id: z.string(),
        domain: z.string(),
        status: z.string(),
        verifiedAt: z.string().nullable(),
        autoCheckUntil: z.string().nullable(),
        /** The local parts of the addresses that send from it, as "help@". */
        localParts: z.array(z.string()),
      }),
    ),
  }),
  responseDescription: "The sending domains",
  handler: async ({ db }) => {
    // ponytail: 100 domains and 1,000 sending addresses per workspace; page it if a workspace outgrows that.
    const domains = await db
      .select({
        id: emailSendingDomains.id,
        domain: emailSendingDomains.domain,
        status: emailSendingDomains.status,
        verifiedAt: emailSendingDomains.verifiedAt,
        autoCheckUntil: emailSendingDomains.autoCheckUntil,
      })
      .from(emailSendingDomains)
      .orderBy(asc(emailSendingDomains.domain), asc(emailSendingDomains.id))
      .limit(100);
    const senders = await db
      .select({
        address: channelAccounts.address,
        sendingDomainId: channelAccounts.sendingDomainId,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.role, "sending"),
          isNull(channelAccounts.deletedAt),
        ),
      )
      .limit(1000);
    return {
      domains: domains.map((d) => {
        const parts = new Set<string>();
        for (const { address, sendingDomainId } of senders) {
          if (!address) continue;
          // An address without a stored link belongs to the domain after its @.
          const linked = sendingDomainId
            ? sendingDomainId === d.id
            : address.slice(address.lastIndexOf("@") + 1).toLowerCase() ===
              d.domain.toLowerCase();
          const part = linked ? localPart(address) : null;
          if (part) parts.add(part);
        }
        return {
          id: d.id,
          domain: d.domain,
          status: d.status,
          verifiedAt: d.verifiedAt?.toISOString() ?? null,
          autoCheckUntil: d.autoCheckUntil?.toISOString() ?? null,
          localParts: [...parts].sort(),
        };
      }),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...list,
);
