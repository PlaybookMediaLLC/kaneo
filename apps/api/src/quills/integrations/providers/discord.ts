// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { providerJson } from "../../framework/integration-config";
import {
  form,
  formHeaders,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

export const discord = {
  name: "Discord",
  hosts: /^discord\.com$/,
  category: "notifications",
  description: "Post feedback events to Discord channels.",
  events: ["post.created", "post.status_changed", "comment.created"],
  channels: true,
  // The bot token posts messages; the OAuth grant adds the bot to one server.
  credentials: ["clientId", "clientSecret", "botToken"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://discord.com/oauth2/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: "bot",
      permissions: "3072",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      }),
    );
    const guild = record(token.guild);
    const guildId = text(guild.id);
    if (!/^\d{1,30}$/.test(guildId)) throw rejected();
    // The grant's user token is not kept: messages use the bot token.
    return {
      secrets: {},
      workspaceName: text(guild.name) || "Discord",
      account: text(guild.name) || null,
      config: { guildId },
    };
  },
  destinations: async (_secrets, config, creds) => {
    const guildId = text(config.guildId);
    if (!/^\d{1,30}$/.test(guildId)) return [];
    return list(
      await providerJson(
        `https://discord.com/api/v10/guilds/${guildId}/channels`,
        { headers: { authorization: `Bot ${creds.botToken ?? ""}` } },
      ),
    )
      .map(record)
      .filter((channel) => channel.type === 0)
      .map((channel) => ({
        id: text(channel.id),
        name: `#${text(channel.name)}`,
      }));
  },
  statuses: [],
} satisfies OAuthProvider;
