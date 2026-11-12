import { expect, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import "../../integrations/providers/azure-devops.fixture";
import { JIRA_CLOUD_ID } from "../../integrations/providers/jira.fixture";
import { LINEAR_ISSUE } from "../../integrations/providers/linear.fixture";
import {
  CONTENT,
  describeDelivery,
  future,
  type DeliveryCase,
} from "./tracker-delivery.fixture";

// Issue tracker deliveries (Jira, Linear, Azure DevOps): the worker evidence table of
// tracker-delivery.fixture.ts. A later provider adds its own test file like this one.

let pool: Pool;
vi.mock("../../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const LINEAR_TEAM = "5b1f4c3e-0000-4000-8000-000000000001";

const trackers: DeliveryCase[] = [
  {
    type: "jira",
    channel: "10000:10001",
    config: {
      cloudId: JIRA_CLOUD_ID,
      account: "https://contract.atlassian.net",
      scopes: "read:jira-work write:jira-work offline_access",
    },
    secrets: (workspaceId) => ({
      accessToken: `jira_${workspaceId}`,
      refreshToken: `jira_refresh_${workspaceId}`,
      expiresAt: future(),
    }),
    authorization: (workspaceId) => `Bearer jira_${workspaceId}`,
    create: `POST /api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}/rest/api/3/issue`,
    token: "POST /auth.atlassian.com/oauth/token",
    refreshedToken: "jira_contract_token",
    link: {
      externalId: "APP-1",
      externalUrl: "https://contract.atlassian.net/browse/APP-1",
      externalDisplayId: null,
    },
    // Plain text nodes: the post text is never markup.
    request: (body, { board, author }) =>
      expect(body).toEqual({
        fields: {
          project: { id: "10000" },
          issuetype: { id: "10001" },
          summary: "Integration post",
          description: {
            version: 1,
            type: "doc",
            content: [
              "First line",
              "<script>alert(1)</script> & **bold**",
              "rule",
              `Submitted by: ${author}`,
              `Board: ${board}`,
            ].map((text) =>
              text === "rule"
                ? { type: "rule" }
                : { type: "paragraph", content: [{ type: "text", text }] },
            ),
          },
        },
      }),
  },
  {
    type: "linear",
    channel: LINEAR_TEAM,
    config: { scopes: "read issues:create" },
    secrets: (workspaceId) => ({
      accessToken: `linear_${workspaceId}`,
      refreshToken: `linear_refresh_${workspaceId}`,
      expiresAt: future(),
    }),
    authorization: (workspaceId) => `Bearer linear_${workspaceId}`,
    create: "POST /api.linear.app/graphql",
    token: "POST /api.linear.app/oauth/token",
    refreshedToken: "linear_contract_token",
    link: {
      externalId: LINEAR_ISSUE,
      externalUrl: "https://linear.app/contract/issue/ENG-1/integration-post",
      externalDisplayId: "ENG-1",
    },
    request: (body, { board, author }) =>
      expect(body).toEqual({
        query: expect.stringContaining("issueCreate(input: $input)"),
        variables: {
          input: {
            teamId: LINEAR_TEAM,
            title: "Integration post",
            // Markdown, as the post content is.
            description: `${CONTENT}\n\n---\n**Submitted by:** ${author}\n**Board:** ${board}`,
          },
        },
      }),
  },
  {
    type: "azure_devops",
    // A project name with a space: the channel route and the target rule accept it.
    channel: "Contract App:Bug",
    config: { organization: "contract" },
    secrets: (workspaceId) => ({ accessToken: `pat_${workspaceId}` }),
    authorization: (workspaceId) =>
      `Basic ${Buffer.from(`:pat_${workspaceId}`).toString("base64")}`,
    create:
      "POST /dev.azure.com/contract/Contract%20App/_apis/wit/workitems/$Bug",
    link: {
      externalId: "42",
      // Built on the fixed host, not taken from the answer.
      externalUrl:
        "https://dev.azure.com/contract/Contract%20App/_workitems/edit/42",
      externalDisplayId: null,
    },
    request: (body, { board, author }) =>
      expect(body).toEqual([
        { op: "add", path: "/fields/System.Title", value: "Integration post" },
        {
          op: "add",
          path: "/fields/System.Description",
          // Escaped HTML: the post text is never markup.
          value: `<p>First line</p><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; **bold**</p><hr><p>Submitted by: ${author}</p><p>Board: ${board}</p>`,
        },
      ]),
  },
];

describeDelivery(trackers, (testPool) => (pool = testPool));
