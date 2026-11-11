import { providerAnswers } from "../provider-edge.fixture";

// Answers of the local Notion server. The database list is longer than the route's limit of 200.
const id = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
providerAnswers.push((route) => {
  if (route === "POST /api.notion.com/v1/oauth/token")
    return {
      access_token: "notion-access",
      workspace_name: "Contract workspace",
      owner: { type: "user", user: { name: "Contract" } },
    };
  if (route === "POST /api.notion.com/v1/search")
    return {
      results: [
        { id: "../1", title: [{ plain_text: "Not an ID" }] },
        { id: id(0), title: [{ plain_text: "Road" }, { plain_text: "map" }] },
        { id: id(1), title: [] },
        ...Array.from({ length: 250 }, (_, i) => ({
          id: id(i + 2),
          title: [{ plain_text: `Database ${i + 2}` }],
        })),
      ],
    };
  return undefined;
});
