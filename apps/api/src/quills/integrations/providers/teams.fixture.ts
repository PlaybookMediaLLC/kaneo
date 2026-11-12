import { providerAnswers } from "../provider-edge.fixture";

/** The team that the local Graph server lists for a Teams connection. */
export const TEAMS_TEAM = "6f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

// Local Microsoft answers for providers/teams.test.ts. Each list also holds one entry that the provider drops.
providerAnswers.push((route) => {
  if (
    route === "POST /login.microsoftonline.com/organizations/oauth2/v2.0/token"
  )
    return {
      token_type: "Bearer",
      access_token: "teams-contract-token",
      refresh_token: "teams-contract-refresh",
      expires_in: 3600,
    };
  if (route === "GET /graph.microsoft.com/v1.0/me/joinedTeams")
    return {
      value: [
        { id: TEAMS_TEAM, displayName: "Contract team" },
        { id: "not-a-guid", displayName: "Dropped" },
      ],
    };
  if (route === `GET /graph.microsoft.com/v1.0/teams/${TEAMS_TEAM}/channels`)
    return {
      value: [
        { id: "19:contract@thread.tacv2", displayName: "General" },
        { id: "../escape", displayName: "Dropped" },
      ],
    };
  return undefined;
});
