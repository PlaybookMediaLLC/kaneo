import {
  channelAccounts,
  emailSendingDomains,
} from "../../database/quills/schema/channel-accounts";
import { teams } from "../../database/quills/schema/teams";
import { fixture, type ContractEnv } from "../framework/contract";

/** A sending domain and one address on it, so the strict response check sees a full item. */
const sendingDomain = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const domain = `${env.id("send").replaceAll("_", "-")}.example.com`;
    const [team] = await db
      .insert(teams)
      .values({ name: env.id("team") })
      .returning({ id: teams.id });
    const [row] = await db
      .insert(emailSendingDomains)
      .values({ owningTeamId: team!.id, domain })
      .returning({ id: emailSendingDomains.id });
    await db.insert(channelAccounts).values({
      owningTeamId: team!.id,
      role: "sending",
      address: `help@${domain}`,
      sendingDomainId: row!.id,
    });
    return domain;
  });

export const listQuillsSendingDomains = fixture({
  seed: async (env) => ({ domain: await sendingDomain(env, env.a) }),
  valid: () => ({}),
});
