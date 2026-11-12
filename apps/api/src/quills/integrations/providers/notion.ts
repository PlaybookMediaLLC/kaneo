// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { issueParts, uncertain } from "../delivery";
import {
  form,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^api\.notion\.com$/;
const api = "https://api.notion.com/v1";
const json = { "content-type": "application/json", accept: "application/json" };
// A Notion ID is a UUID with dashes.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A paragraph block of plain rich text: Notion never reads it as markup. */
const paragraph = (content: string) => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: [{ type: "text", text: { content } }] },
});

export const notion = {
  name: "Notion",
  hosts,
  category: "issue_tracking",
  description: "Create Notion database pages from new feedback.",
  events: ["post.created"],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `${api}/oauth/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      owner: "user",
      state,
    })}`,
  // The OAuth app authenticates with HTTP Basic. Notion access tokens do not expire.
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson(
        `${api}/oauth/token`,
        {
          method: "POST",
          headers: {
            ...json,
            authorization: `Basic ${Buffer.from(`${creds.clientId ?? ""}:${creds.clientSecret ?? ""}`).toString("base64")}`,
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        },
        hosts,
      ),
    );
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    return {
      secrets: { accessToken },
      workspaceName: text(token.workspace_name) || "Notion",
      account: text(record(record(token.owner).user).name) || null,
    };
  },
  // The databases that the teammate shared with the integration, most recently edited first.
  destinations: async (secrets) => {
    const results = record(
      await providerJson(
        `${api}/search`,
        {
          method: "POST",
          headers: {
            ...json,
            authorization: `Bearer ${secrets.accessToken ?? ""}`,
            "notion-version": "2022-06-28",
          },
          body: JSON.stringify({
            filter: { property: "object", value: "database" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            page_size: 100,
          }),
        },
        hosts,
      ),
    ).results;
    if (!Array.isArray(results)) throw new ProviderCallError(502);
    return results
      .map(record)
      .filter((database) => uuid.test(text(database.id)))
      .map((database) => ({
        id: text(database.id),
        name:
          list(database.title)
            .map((part) => text(record(part).plain_text))
            .join("") || "Untitled",
      }));
  },
  statuses: [],
  // A channel ID is a database ID, which the default rule (30 letters and digits) refuses.
  target: (target) => uuid.test(target),
  // A page in the database for a new post. Every part is plain rich text.
  deliver: async ({ secrets, target, content }) => {
    const { title, paragraphs, footer } = issueParts(content);
    // Notion takes at most 100 blocks: the lines after the 96th join one last paragraph. The content
    // has at most 2000 characters, Notion's limit for one text.
    const lines = [
      ...paragraphs.slice(0, 96),
      paragraphs.slice(96).join("\n"),
    ].filter(Boolean);
    const page = record(
      await providerJson(
        `${api}/pages`,
        {
          method: "POST",
          headers: {
            ...json,
            authorization: `Bearer ${secrets.accessToken ?? ""}`,
            "notion-version": "2022-06-28",
          },
          body: JSON.stringify({
            parent: { database_id: target },
            // `title` is the ID of every database's title property.
            properties: { title: { title: [{ text: { content: title } }] } },
            children: [
              ...lines.map(paragraph),
              { object: "block", type: "divider", divider: {} },
              ...footer.map(paragraph),
            ],
          }),
        },
        hosts,
      ),
    );
    const id = text(page.id);
    // A 2xx without a page ID: the page may exist.
    if (!uuid.test(id)) return uncertain;
    const link = URL.parse(text(page.url))?.href;
    return {
      state: "succeeded",
      result: {
        externalId: id,
        externalUrl: link?.startsWith("https://www.notion.so/") ? link : null,
      },
    };
  },
} satisfies OAuthProvider;
