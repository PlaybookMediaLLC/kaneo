import { providerAnswers } from "../provider-edge.fixture";

// Answers of the local Monday.com server. GraphQL has one path, so one answer holds every query's
// data: the connect reads `me`, the list reads `boards`, and a delivery reads `create_item`, then
// `create_update`. The board list is longer than the route's limit of 200.
export const MONDAY_ITEM = "5001";
providerAnswers.push((route) => {
  if (route === "POST /auth.monday.com/oauth2/token")
    return { access_token: "monday-access" };
  if (route === "POST /api.monday.com/v2")
    return {
      data: {
        me: { name: "Contract", account: { name: "Contract account" } },
        boards: [
          { id: "../1", name: "Not an ID" },
          ...Array.from({ length: 250 }, (_, i) => ({
            id: String(4000 + i),
            name: `Board ${i}`,
          })),
        ],
        create_item: { id: MONDAY_ITEM },
        create_update: { id: "6001" },
      },
    };
  return undefined;
});
