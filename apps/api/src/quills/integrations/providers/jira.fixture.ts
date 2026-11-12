import { providerAnswers } from "../provider-edge.fixture";

// Local Jira answers. The connect route fixture is in ../oauth.fixture.ts.
export const JIRA_CLOUD_ID = "11111111-2222-3333-4444-555555555555";
const api = `/api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}/rest/api/3`;

providerAnswers.push((route) => {
  if (route === "POST /auth.atlassian.com/oauth/token")
    return {
      access_token: "jira_contract_token",
      refresh_token: "jira_contract_refresh",
      expires_in: 3600,
    };
  if (route === "GET /api.atlassian.com/oauth/token/accessible-resources")
    return [
      {
        id: JIRA_CLOUD_ID,
        name: "Contract site",
        url: "https://contract.atlassian.net",
      },
    ];
  if (route === `GET ${api}/project/search`)
    return {
      values: [
        { id: "10000", key: "APP", name: "App" },
        { id: "../x", key: "BAD", name: "Bad ID" },
      ],
    };
  if (route === `GET ${api}/issuetype/project`)
    return [
      { id: "10001", name: "Bug", subtask: false },
      { id: "10002", name: "Task", subtask: false },
    ];
  return undefined;
});
