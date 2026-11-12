import { providerAnswers } from "../provider-edge.fixture";

// Local Linear answers. The connect route fixture is in ../oauth.fixture.ts. The GraphQL route
// answers both queries: the exchange reads `organization`, the list reads `teams`.
providerAnswers.push((route) => {
  if (route === "POST /api.linear.app/oauth/token")
    return {
      access_token: "linear_contract_token",
      refresh_token: "linear_contract_refresh",
      expires_in: 86399,
    };
  if (route === "POST /api.linear.app/graphql")
    return {
      data: {
        organization: { name: "Contract", urlKey: "contract" },
        teams: {
          nodes: [
            { id: "5b1f4c3e-0000-4000-8000-000000000001", name: "Engineering" },
            { id: "../x", name: "Bad ID" },
          ],
        },
      },
    };
  return undefined;
});
