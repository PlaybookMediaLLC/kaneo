// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { isUuid } from "@kaneo/ids";
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { grantedScopes, issueBody, issueParts, uncertain } from "../delivery";
import {
  expiresAt,
  form,
  formHeaders,
  list,
  record,
  refreshGrant,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(api\.)?linear\.app$/;
/** Lists teams, and creates issues. */
const SCOPE = "read,issues:create";

/** One GraphQL request. Returns the whole answer: `data`, and `errors` when Linear refused it. */
const graphqlAnswer = async (
  token: string,
  query: string,
  variables?: Record<string, unknown>,
) =>
  record(
    await providerJson(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
      },
      hosts,
    ),
  );
/** One GraphQL query. Returns `data`, or {} when the answer has none. */
const graphql = async (token: string, query: string) =>
  record((await graphqlAnswer(token, query)).data);

const CREATE_ISSUE = `mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`;

/** One token request. Linear rotates the refresh token on each refresh. */
const tokenRequest = async (body: Record<string, string>) =>
  record(
    await providerJson(
      "https://api.linear.app/oauth/token",
      { method: "POST", headers: formHeaders, body: form(body) },
      hosts,
    ),
  );

export const linear = {
  name: "Linear",
  hosts,
  category: "issue_tracking",
  description: "Create Linear issues from new feedback.",
  events: ["post.created"],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  deliveryScopes: ["issues:create"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://linear.app/oauth/authorize?${form({
      client_id: creds.clientId!,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      scope: SCOPE,
      prompt: "consent",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = await tokenRequest({
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    const organization = record(
      (await graphql(accessToken, "{ organization { name urlKey } }"))
        .organization,
    );
    return {
      secrets: {
        accessToken,
        refreshToken: text(token.refresh_token),
        expiresAt: expiresAt(token),
      },
      workspaceName: text(organization.name) || "Linear",
      account: text(organization.urlKey) || null,
      config: { scopes: grantedScopes(token, SCOPE) },
    };
  },
  destinations: async (secrets) => {
    const teams = record(
      (
        await graphql(
          secrets.accessToken ?? "",
          "{ teams(first: 100) { nodes { id name } } }",
        )
      ).teams,
    ).nodes;
    // An answer without the team list (GraphQL errors) is a provider failure, not an empty list.
    if (!Array.isArray(teams)) throw new ProviderCallError(502);
    return teams
      .map(record)
      .filter((team) => /^[A-Za-z0-9-]{1,64}$/.test(text(team.id)))
      .map((team) => ({ id: text(team.id), name: text(team.name) }));
  },
  statuses: [],
  // A team ID: a UUID.
  target: (target) => isUuid(target),
  refresh: (secrets, creds) =>
    refreshGrant(
      tokenRequest({
        client_id: creds.clientId ?? "",
        client_secret: creds.clientSecret ?? "",
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken ?? "",
      }),
      secrets,
    ),
  // An issue for a new post. The body is Markdown, as the post content is.
  deliver: async ({ secrets, target, content }) => {
    const answer = await graphqlAnswer(
      secrets.accessToken ?? "",
      CREATE_ISSUE,
      {
        input: {
          teamId: target,
          title: issueParts(content).title,
          description: issueBody({ content }, 2000),
        },
      },
    );
    const issue = record(record(record(answer.data).issueCreate).issue);
    const id = text(issue.id);
    if (isUuid(id)) {
      const identifier = text(issue.identifier);
      const link = URL.parse(text(issue.url));
      return {
        state: "succeeded",
        result: {
          // The UUID: an identifier changes when the issue moves to another team.
          externalId: id,
          externalDisplayId: /^[A-Z][A-Z0-9]{0,9}-\d{1,10}$/.test(identifier)
            ? identifier
            : undefined,
          externalUrl:
            link?.protocol === "https:" && link.hostname === "linear.app"
              ? link.href
              : null,
        },
      };
    }
    // GraphQL errors and no issueCreate. Only a refusal before the write proves that no issue exists;
    // an internal error or a lock timeout can follow a write, so any other error is uncertain.
    const kinds = list(answer.errors).map((error) => {
      const extensions = record(record(error).extensions);
      return `${text(extensions.type)} ${text(extensions.code)}`.toLowerCase();
    });
    if (!kinds.length || record(answer.data).issueCreate) return uncertain;
    const every = (pattern: RegExp) =>
      kinds.every((kind) => pattern.test(kind));
    if (every(/authenticat|forbidden/))
      return { state: "auth_required", errorCode: "authentication" };
    if (every(/ratelimit/))
      return { state: "retry_wait", errorCode: "unavailable" };
    if (
      every(
        /authenticat|forbidden|ratelimit|invalid input|user error|graphql error|usage limit|feature not accessible/,
      )
    )
      return { state: "failed", errorCode: "provider_failed" };
    return uncertain;
  },
} satisfies OAuthProvider;
