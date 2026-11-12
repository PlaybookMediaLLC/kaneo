import { providerAnswers } from "../provider-edge.fixture";

// Answers of the local ClickUp server. Space 11 has more lists than the route's limit of 200.
export const CLICKUP_TASK = "86a1b2c3d";
providerAnswers.push((route) => {
  if (route === "POST /api.clickup.com/api/v2/oauth/token")
    return { access_token: "clickup-access" };
  if (route === "GET /api.clickup.com/api/v2/team")
    return { teams: [{ id: "900", name: "Contract team" }] };
  if (route === "GET /api.clickup.com/api/v2/team/900/space")
    return {
      spaces: [
        { id: "11", name: "Product" },
        { id: "12", name: "Support" },
        { id: "../13", name: "Not an ID" },
      ],
    };
  if (route === "GET /api.clickup.com/api/v2/space/11/list")
    return {
      lists: Array.from({ length: 250 }, (_, i) => ({
        id: String(2000 + i),
        name: `List ${i}`,
      })),
    };
  if (route === "GET /api.clickup.com/api/v2/space/12/list")
    return { lists: [{ id: "3000", name: "Inbox" }] };
  // A task create in any list.
  if (/^POST \/api\.clickup\.com\/api\/v2\/list\/\d+\/task$/.test(route))
    return {
      id: CLICKUP_TASK,
      url: `https://app.clickup.com/t/${CLICKUP_TASK}`,
    };
  return undefined;
});
