import { isOmittedDoc } from "@kaneo/branding/docs";
import { describe, expect, it } from "vite-plus/test";
import {
  API_REFERENCE_PATH,
  DOCS_BASE_PATH,
  type DocsSidebarSection,
  getDocsUrl,
  normalizeDocsHref,
  sectionContainsPath,
} from "../links";
import {
  type DocsSearchEntry,
  filterDocsPages,
  filterIndexedDocsPages,
  indexDocsSearchEntries,
} from "../search-filter";

describe("docs link normalization", () => {
  it("maps doc slugs to canonical /docs URLs", () => {
    expect(getDocsUrl("index")).toBe(DOCS_BASE_PATH);
    expect(getDocsUrl("core/index")).toBe("/docs/core");
    expect(getDocsUrl("core/installation/index")).toBe(
      "/docs/core/installation",
    );
    expect(getDocsUrl("core/installation/docker-compose")).toBe(
      "/docs/core/installation/docker-compose",
    );
    expect(getDocsUrl("/cli/reference.mdx")).toBe("/docs/cli/reference");
  });

  it("normalizes Mintlify doc-root hrefs while preserving fragments, queries, and external URLs", () => {
    expect(normalizeDocsHref("/core/index")).toBe("/docs/core");
    expect(normalizeDocsHref("/core/installation/index#docker")).toBe(
      "/docs/core/installation#docker",
    );
    expect(normalizeDocsHref("/cli?tab=linux#install")).toBe(
      "/docs/cli?tab=linux#install",
    );
    expect(normalizeDocsHref("/api-reference/introduction")).toBe(
      "/docs/api-reference/introduction",
    );
    expect(normalizeDocsHref("/quills/deployment")).toBe(
      "/docs/quills/deployment",
    );
    expect(normalizeDocsHref("/openapi")).toBe(API_REFERENCE_PATH);
    expect(normalizeDocsHref("/openapi#auth")).toBe(
      `${API_REFERENCE_PATH}#auth`,
    );
    expect(normalizeDocsHref("/openapi.json")).toBe("/openapi.json");
    expect(normalizeDocsHref("/api-reference")).toBe(API_REFERENCE_PATH);
    expect(normalizeDocsHref("/docs/index")).toBe(DOCS_BASE_PATH);
    expect(normalizeDocsHref("/docs/core/index")).toBe("/docs/core");
    expect(normalizeDocsHref("/docs/core/installation/")).toBe(
      "/docs/core/installation",
    );
    expect(normalizeDocsHref("#section-1")).toBe("#section-1");
    expect(normalizeDocsHref("?q=docker")).toBe("?q=docker");
    expect(normalizeDocsHref("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(normalizeDocsHref("/pricing")).toBe("/pricing");
  });

  it("remaps omitted stdio MCP links to the published stateless MCP doc", () => {
    if (isOmittedDoc("core/integrations/mcp")) {
      expect(normalizeDocsHref("/core/integrations/mcp")).toBe(
        "/docs/core/integrations/mcp-stateless",
      );
      expect(normalizeDocsHref("/docs/core/integrations/mcp")).toBe(
        "/docs/core/integrations/mcp-stateless",
      );
    } else {
      expect(normalizeDocsHref("/core/integrations/mcp")).toBe(
        "/docs/core/integrations/mcp",
      );
    }
  });
});

describe("sectionContainsPath", () => {
  const section: DocsSidebarSection = {
    id: "self-hosting",
    title: "Self-hosting",
    icon: "server",
    href: "/docs/core/installation",
    groups: [
      {
        title: "Install",
        items: [
          {
            title: "Overview",
            href: "/docs/core/installation",
            slug: "core/installation/index",
          },
          {
            title: "Docker Compose",
            href: "/docs/core/installation/docker-compose",
            slug: "core/installation/docker-compose",
          },
        ],
      },
    ],
  };

  it("matches section overview and grouped pages regardless of trailing slashes", () => {
    expect(sectionContainsPath(section, "/docs/core/installation")).toBe(true);
    expect(sectionContainsPath(section, "/docs/core/installation/")).toBe(true);
    expect(
      sectionContainsPath(section, "/docs/core/installation/docker-compose"),
    ).toBe(true);
    expect(sectionContainsPath(section, "/docs/cli")).toBe(false);
  });
});

describe("7-tier docs search ranking", () => {
  const entries: DocsSearchEntry[] = [
    {
      id: "tier-7",
      url: "/docs/tier-7",
      title: "Operations guide",
      description: "Daily administration",
      section: "Self-hosting",
      group: "Operations",
      type: "self-hosting",
      keywords: [],
      headings: ["Overview"],
      content: "Run webhook verification inside your reverse proxy.",
    },
    {
      id: "tier-6",
      url: "/docs/core/webhook-url",
      title: "Outbound events",
      description: "Push project updates",
      section: "Integrations",
      group: "Team updates",
      type: "integration",
      keywords: [],
      headings: ["Setup"],
      content: "Configure event subscriptions.",
    },
    {
      id: "tier-5",
      url: "/docs/tier-5",
      title: "Project alerts",
      description: "Deliver webhook notifications to external services.",
      section: "Integrations",
      group: "Alerts",
      type: "integration",
      keywords: [],
      headings: ["Channels"],
      content: "Send payloads on status change.",
    },
    {
      id: "tier-4",
      url: "/docs/tier-4",
      title: "Event streaming",
      description: "Subscribe to updates",
      section: "Integrations",
      group: "Automation",
      type: "integration",
      keywords: ["signing"],
      headings: ["Configure webhook secret"],
      content: "Verify HMAC signatures.",
    },
    {
      id: "tier-3",
      url: "/docs/tier-3",
      title: "Personal webhook setup",
      description: "User notifications",
      section: "Integrations",
      group: "Personal",
      type: "integration",
      keywords: [],
      headings: [],
      content: "Personal alerts.",
    },
    {
      id: "tier-2",
      url: "/docs/tier-2",
      title: "Webhook retries",
      description: "Delivery backoff",
      section: "Integrations",
      group: "Reliability",
      type: "integration",
      keywords: [],
      headings: [],
      content: "Automatic retry schedule.",
    },
    {
      id: "tier-1",
      url: "/docs/tier-1",
      title: "Webhook",
      description: "Overview",
      section: "Integrations",
      group: "Overview",
      type: "integration",
      keywords: [],
      headings: [],
      content: "HTTP callbacks.",
    },
  ];

  it("ranks matches across all 7 relevance tiers case-insensitively", () => {
    const ranked = filterDocsPages(entries, "WEBHOOK");
    expect(ranked.map((item) => item.id)).toEqual([
      "tier-1",
      "tier-2",
      "tier-3",
      "tier-4",
      "tier-5",
      "tier-6",
      "tier-7",
    ]);
  });

  it("returns all entries for empty or whitespace queries", () => {
    expect(filterDocsPages(entries, "")).toHaveLength(entries.length);
    expect(filterDocsPages(entries, "   ")).toHaveLength(entries.length);
  });

  it("breaks ties deterministically by title length, alphabetical title, and URL", () => {
    const tied: DocsSearchEntry[] = [
      {
        ...entries[0],
        id: "b",
        url: "/docs/z",
        title: "Docker compose setup",
      },
      {
        ...entries[0],
        id: "a",
        url: "/docs/a",
        title: "Docker install",
      },
      {
        ...entries[0],
        id: "c",
        url: "/docs/b",
        title: "Docker backups",
      },
    ];
    const indexed = indexDocsSearchEntries(tied);
    expect(
      filterIndexedDocsPages(indexed, "docker").map((item) => item.id),
    ).toEqual(["c", "a", "b"]);
  });
});
