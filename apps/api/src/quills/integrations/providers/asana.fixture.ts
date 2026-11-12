import { providerAnswers } from "../provider-edge.fixture";

// Answers of the local Asana server. The project list is longer than the route's limit of 200.
providerAnswers.push((route) => {
  if (route === "POST /app.asana.com/-/oauth_token")
    return {
      access_token: "asana-access",
      refresh_token: "asana-refresh",
      expires_in: 3600,
    };
  if (route === "GET /app.asana.com/api/1.0/users/me")
    return {
      data: {
        name: "Contract",
        workspaces: [{ gid: "1200", name: "Contract workspace" }],
      },
    };
  if (route === "GET /app.asana.com/api/1.0/projects")
    return {
      data: [
        { gid: "../1200", name: "Not an ID" },
        ...Array.from({ length: 250 }, (_, i) => ({
          gid: String(1000 + i),
          name: `Project ${i}`,
        })),
      ],
    };
  return undefined;
});
