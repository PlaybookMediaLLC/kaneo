import { providerAnswers } from "../provider-edge.fixture";

// Answers of the local Trello server. Built at run time: no token-like literal in the source.
export const TRELLO_TOKEN = "contract".repeat(8);
/** A Trello ID: 24 hexadecimal digits. */
export const trelloId = (i: number) => i.toString(16).padStart(24, "0");
export const TRELLO_CARD = trelloId(101);
export const TRELLO_CARD_URL = "https://trello.com/c/Contract";

providerAnswers.push((route) => {
  if (route === "GET /api.trello.com/1/members/me")
    return { username: "contract", fullName: "Contract" };
  if (route === "GET /api.trello.com/1/members/me/boards")
    return [
      { id: trelloId(1), name: "Roadmap" },
      { id: trelloId(2), name: "Support" },
      { id: "../x", name: "Not an ID" },
    ];
  if (route === `GET /api.trello.com/1/boards/${trelloId(1)}/lists`)
    return [{ id: trelloId(11), name: "Inbox" }];
  // A card create. The list is in the body, so one route answers every channel.
  if (route === "POST /api.trello.com/1/cards")
    return { id: TRELLO_CARD, shortUrl: TRELLO_CARD_URL };
  return undefined;
});
