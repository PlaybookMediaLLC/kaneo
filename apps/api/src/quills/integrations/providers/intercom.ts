// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { providerJson } from "../../framework/integration-config";
import {
  form,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(app\.intercom\.com|api\.intercom\.io)$/;
const json = {
  "content-type": "application/json",
  accept: "application/json",
};
const bearer = (token: string) => ({
  ...json,
  authorization: `Bearer ${token}`,
  "intercom-version": "2.14",
});

// Intercom access tokens do not expire, so there is no refresh.
export const intercom = {
  name: "Intercom",
  hosts,
  category: "support_crm",
  description:
    "Show Intercom contact details, such as plan and company, next to a customer.",
  events: [],
  channels: false,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://app.intercom.com/oauth?${form({
      client_id: creds.clientId!,
      state,
      redirect_uri: redirectUri,
    })}`,
  exchange: async (code, _redirectUri, creds) => {
    const answer = record(
      await providerJson(
        "https://api.intercom.io/auth/eagle/token",
        {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
          }),
        },
        hosts,
      ),
    );
    const accessToken = text(answer.token);
    if (!accessToken) throw rejected();
    // The app name labels the connection. Without it, the connection is "Intercom".
    const app = record(
      record(
        await providerJson(
          "https://api.intercom.io/me",
          { headers: bearer(accessToken) },
          hosts,
        ).catch(() => null),
      ).app,
    );
    const name = text(app.name);
    return {
      secrets: { accessToken },
      workspaceName: name || "Intercom",
      account: name || null,
    };
  },
  destinations: async () => [],
  statuses: [],
  contact: async (secrets, _config, email) => {
    const headers = bearer(secrets.accessToken ?? "");
    const [found] = list(
      record(
        await providerJson(
          "https://api.intercom.io/contacts/search",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              query: { field: "email", operator: "=", value: email },
              pagination: { per_page: 1 },
            }),
          },
          hosts,
        ),
      ).data,
    ).map(record);
    const id = text(found?.id);
    if (!found || !/^[A-Za-z0-9]{1,64}$/.test(id)) return null;
    const plan = record(found.custom_attributes).plan;
    // The search gives company and tag references without names. Read the names, both at once; a
    // failed read leaves its field out.
    const names = (kind: "companies" | "tags") =>
      providerJson(
        `https://api.intercom.io/contacts/${id}/${kind}`,
        { headers },
        hosts,
      )
        .then((answer) =>
          list(record(answer).data)
            .map((item) => text(record(item).name))
            .filter(Boolean),
        )
        .catch(() => [] as string[]);
    const [companies, tags] = await Promise.all([
      names("companies"),
      names("tags"),
    ]);
    return {
      name: text(found.name) || null,
      company: companies[0] ?? null,
      // "_" opens the contact in the signed-in teammate's current app.
      url: `https://app.intercom.com/a/apps/_/users/${id}`,
      fields: [
        ...(["string", "number", "boolean"].includes(typeof plan)
          ? [{ label: "Plan", value: String(plan) }]
          : []),
        ...(tags.length ? [{ label: "Tags", value: tags.join(", ") }] : []),
      ],
    };
  },
} satisfies OAuthProvider;
