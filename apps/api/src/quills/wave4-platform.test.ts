import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../database/schema";
import { principal } from "../database/quills/schema/auth";
import { boards } from "../database/quills/schema/boards";
import { companies } from "../database/quills/schema/companies";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../database/quills/schema/kb";
import { postTasks } from "../database/quills/schema/platform-links";
import { posts, postVotes } from "../database/quills/schema/posts";
import { postStatuses } from "../database/quills/schema/statuses";
import {
  CUSTOMER_CONTEXT_END,
  CUSTOMER_CONTEXT_START,
  formatIssueBody,
  formatTaskDescriptionFromIssue,
} from "../plugins/github/utils/format";
import { restrictedMember } from "./feedback/taxonomy-harness.fixture";
import {
  assertSafeZipEntryName,
  buildZipArchive,
  extractZipArchive,
} from "./framework/archive-io";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "./framework/contract";
import quillsRouter from "./index";
import publicRouter from "./public";
import { parseWorkspaceZipBundle } from "./transfer/zip-bundle";

process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "wave4-test-encryption-key";

let pool: Pool;
vi.mock("../database/index", () => ({
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
vi.mock("../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

describe("Wave 4 pure guards (#305, #327)", () => {
  it("appends PII-redacted GitHub customer context block and strips it cleanly on inbound echo (#305)", () => {
    const originalDesc =
      "Implement SAML SSO login flow for enterprise tenants.";
    const issueBody = formatIssueBody(originalDesc, "task_123", {
      totalVotes: 14,
      uniqueCompanies: 3,
      companyNames: ["Acme Corp", "Globex", "Initech"],
      linkedPostTitles: ["SAML SSO support"],
    });
    expect(issueBody).toContain(CUSTOMER_CONTEXT_START);
    expect(issueBody).toContain(CUSTOMER_CONTEXT_END);
    expect(issueBody).toContain("Acme Corp, Globex, Initech");
    expect(issueBody).toContain("<sub>Task: task_123</sub>");

    // Round-trip inbound GitHub webhook edit strips both the footer and context block (including CRLF)
    const restored = formatTaskDescriptionFromIssue(
      issueBody.replace(/\n/g, "\r\n"),
      "task_123",
    );
    expect(restored).toBe(originalDesc);

    // Malicious company name attempting to inject closing comment marker is neutralized
    const injected = formatIssueBody("Fix bug", "task_999", {
      totalVotes: 2,
      uniqueCompanies: 1,
      companyNames: ["Evil <!-- -->\nCo"],
      linkedPostTitles: ["Title --> inject"],
    });
    expect(injected.split(CUSTOMER_CONTEXT_END)).toHaveLength(2);
    expect(formatTaskDescriptionFromIssue(injected, "task_999")).toBe(
      "Fix bug",
    );
  });

  it("builds & extracts standard PKZIP archives, rejects Zip Slip paths, and catches forged uncompSize bombs (#327)", () => {
    const zip = buildZipArchive([
      { name: "manifest.json", data: '{"version":1}' },
      { name: "articles/hello.md", data: "# Hello world\n" },
    ]);
    const files = extractZipArchive(zip);
    expect(files.get("manifest.json")?.toString("utf8")).toBe('{"version":1}');
    expect(files.get("articles/hello.md")?.toString("utf8")).toBe(
      "# Hello world\n",
    );

    expect(() => assertSafeZipEntryName("../etc/passwd")).toThrow();
    expect(() => assertSafeZipEntryName("/absolute/path")).toThrow();
    expect(() => assertSafeZipEntryName("data/../../escape.json")).toThrow();

    // Forged uncompSize header mismatch must be rejected
    const payload = Buffer.alloc(4096, 0x41);
    const bombZip = buildZipArchive([{ name: "big.txt", data: payload }]);
    const forged = Buffer.from(bombZip);
    // Corrupt central-directory uncompSize (offset 24 inside CD entry starting with 0x02014b50)
    const cdIdx = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    forged.writeUInt32LE(10, cdIdx + 24);
    expect(() => extractZipArchive(forged)).toThrow();
  });
});

describe.skipIf(!url)(
  "Wave 4 real PostgreSQL integration (#305, #327, #307)",
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
    }, 120_000);

    afterAll(() => stopContract());

    async function teamJson(
      method: string,
      path: string,
      opts?: { body?: unknown; user?: string },
    ): Promise<{ status: number; body: any }> {
      const res = await app.request(`/quills/${contractEnv().a}${path}`, {
        method,
        headers: {
          "x-test-user": opts?.user ?? contractEnv().owner,
          ...(opts?.body !== undefined && {
            "content-type": "application/json",
          }),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }

    // -------------------------------------------------------------------------
    // #305: Task Customer Context (Private-Project + Revenue Gating)
    // -------------------------------------------------------------------------
    it("#305 enforces private-project visibility and quills:view_revenue gating on GET /tasks/{taskId}/customer-context", async () => {
      const env = contractEnv();
      const projectId = env.id("proj");
      const taskId = env.id("task");
      await env.db.insert(kaneo.projectTable).values({
        id: projectId,
        workspaceId: env.a,
        name: "Core Platform",
        slug: projectId,
        lastTaskNumber: 1,
      });
      await env.db.insert(kaneo.taskTable).values({
        id: taskId,
        projectId,
        title: "Add SAML SSO",
        number: 1,
      });

      const seeded = await env.scoped(env.a, async (db, actor) => {
        const [board] = await db
          .insert(boards)
          .values({ name: "Roadmap W4", slug: env.id("brd") })
          .returning({ id: boards.id });
        const [status] = await db
          .select({ id: postStatuses.id })
          .from(postStatuses)
          .limit(1);
        const [comp] = await db
          .insert(companies)
          .values({
            name: "Enterprise Co",
            plan: "enterprise",
            mrrCents: 450000,
            churnRisk: true,
            source: "manual",
          })
          .returning({ id: companies.id });
        const [cust] = await db
          .insert(principal)
          .values({
            type: "customer",
            displayName: "Dana Requester",
            contactEmail: "dana@enterprise.test",
            companyId: comp!.id,
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        const [post] = await db
          .insert(posts)
          .values({
            boardId: board!.id,
            title: "Enterprise SAML Login",
            content: "We need SAML 2.0",
            principalId: actor.principalId,
            statusId: status!.id,
            voteCount: 1,
          })
          .returning({ id: posts.id });
        await db.insert(postVotes).values({
          postId: post!.id,
          principalId: cust!.id,
          importance: "critical",
        });
        await db.insert(postTasks).values({
          postId: post!.id,
          taskId,
          source: "manual",
        });
        return { postId: post!.id };
      });

      // 1. Owner sees full context including MRR, never customer email
      const ownerRes = await teamJson(
        "GET",
        `/tasks/${taskId}/customer-context`,
      );
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.summary.totalLinkedPosts).toBe(1);
      expect(ownerRes.body.summary.uniqueRequesters).toBe(1);
      expect(ownerRes.body.summary.uniqueCompanies).toBe(1);
      expect(ownerRes.body.summary.totalMrrCents).toBe(450000);
      expect(ownerRes.body.linkedPosts[0].id).toBe(seeded.postId);
      expect(ownerRes.body.companies[0].name).toBe("Enterprise Co");
      expect(ownerRes.body.companies[0].churnRisk).toBe(true);
      expect(JSON.stringify(ownerRes.body)).not.toContain(
        "dana@enterprise.test",
      );

      // 2. Member WITHOUT access to projectId is denied (private project boundary enforced by route `project:` check)
      const noProjectUser = await restrictedMember(env, [], "member");
      const deniedRes = await teamJson(
        "GET",
        `/tasks/${taskId}/customer-context`,
        { user: noProjectUser },
      );
      expect(deniedRes.status).toBe(403);
      expect(JSON.stringify(deniedRes.body)).not.toContain("Enterprise Co");

      // 3. Viewer WITH project access but WITHOUT quills:view_revenue sees context with mrrCents = null
      const viewerWithProject = await restrictedMember(
        env,
        [projectId],
        "viewer",
      );
      const viewerRes = await teamJson(
        "GET",
        `/tasks/${taskId}/customer-context`,
        { user: viewerWithProject },
      );
      expect(viewerRes.status).toBe(200);
      expect(viewerRes.body.summary.totalMrrCents).toBeNull();
      expect(viewerRes.body.companies[0].mrrCents).toBeNull();
      expect(JSON.stringify(viewerRes.body)).not.toContain("450000");
    });

    // -------------------------------------------------------------------------
    // #327: Full Workspace Zip Export, Incremental `since` & Scheduled S3/R2
    // -------------------------------------------------------------------------
    it("#327 exports portable .zip with NDJSON + Markdown KB, supports incremental since, enforces SSRF guard, and omits export_schedules credentials", async () => {
      const env = contractEnv();
      // Seed a KB article so articles/<slug>.md is emitted
      await env.scoped(env.a, async (db, actor) => {
        const [cat] = await db
          .insert(helpCenterCategories)
          .values({ name: "Export Docs", slug: env.id("cat"), isPublic: true })
          .returning({ id: helpCenterCategories.id });
        await db.insert(helpCenterArticles).values({
          categoryId: cat!.id,
          slug: "export-roundtrip-guide",
          title: "Export Roundtrip Guide",
          content: "# Backup Guide\n\nAll data stays portable.",
          principalId: actor.principalId,
          publishedAt: new Date(),
        });
      });

      // 1. SSRF guard rejects loopback & cloud metadata endpoints
      const ssrfLoopback = await teamJson("PUT", "/transfer/export-schedule", {
        body: {
          enabled: true,
          cadence: "daily",
          destinationEndpoint: "http://127.0.0.1:9000",
          bucket: "local-bucket",
          accessKey: "AKIA12345678",
          secretAccessKey: "secret-key-12345678",
        },
      });
      expect(ssrfLoopback.status).toBe(400);

      const ssrfMeta = await teamJson("PUT", "/transfer/export-schedule", {
        body: {
          enabled: true,
          cadence: "daily",
          destinationEndpoint: "http://169.254.169.254/latest/meta-data",
          bucket: "meta-bucket",
          accessKey: "AKIA12345678",
          secretAccessKey: "secret-key-12345678",
        },
      });
      expect(ssrfMeta.status).toBe(400);

      // 2. Valid HTTPS S3/R2 schedule stores sealed credentials and never leaks them
      const secretVal = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECRET999";
      const schedRes = await teamJson("PUT", "/transfer/export-schedule", {
        body: {
          enabled: true,
          cadence: "weekly",
          destinationEndpoint: "https://s3.us-east-1.amazonaws.com",
          bucket: "acme-backups",
          prefix: "nightly/",
          region: "us-east-1",
          accessKey: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: secretVal,
        },
      });
      expect(schedRes.status).toBe(200);
      expect(schedRes.body.schedule.hasCredentials).toBe(true);
      expect(JSON.stringify(schedRes.body)).not.toContain(secretVal);

      // 3. Full workspace .zip export contains manifest.json, data/*.ndjson, articles/*.md, and NEVER export_schedules
      const expRes = await teamJson("POST", "/transfer/full-export", {
        body: { format: "zip" },
      });
      expect(expRes.status).toBe(200);
      expect(expRes.body.manifest.format).toBe("kaneo-workspace-zip");
      expect(expRes.body.manifest.markdownArticleCount).toBeGreaterThanOrEqual(
        1,
      );

      const zipBuf = Buffer.from(expRes.body.zipBase64, "base64");
      const rawEntries = extractZipArchive(zipBuf);
      expect(rawEntries.has("manifest.json")).toBe(true);
      expect(rawEntries.has("articles/export-roundtrip-guide.md")).toBe(true);
      expect(
        rawEntries.get("articles/export-roundtrip-guide.md")?.toString("utf8"),
      ).toContain("All data stays portable.");
      expect(rawEntries.has("data/export_schedules.ndjson")).toBe(false);
      expect(zipBuf.toString("utf8")).not.toContain(secretVal);

      // Round-trip parse validates cleanly as a full WorkspaceArchive with secrets redacted
      const parsed = parseWorkspaceZipBundle(zipBuf);
      expect(parsed.archive.format).toBe("quills-workspace");
      for (const sRow of parsed.archive.tables.settings ?? []) {
        expect(sRow.widget_secret ?? null).toBeNull();
        expect(sRow.assistant_provider_secrets ?? null).toBeNull();
      }
      expect(
        (parsed.archive.tables.kb_articles ?? []).some(
          (row) => row.slug === "export-roundtrip-guide",
        ),
      ).toBe(true);

      // 4. Incremental `since` export in the future returns 0 markdown articles
      const futureIso = new Date(Date.now() + 60_000).toISOString();
      const incRes = await teamJson("POST", "/transfer/full-export", {
        body: { format: "zip", since: futureIso },
      });
      expect(incRes.status).toBe(200);
      expect(incRes.body.manifest.since).toBeTruthy();
      expect(incRes.body.manifest.markdownArticleCount).toBe(0);

      // Clean up schedule
      const delSched = await teamJson("DELETE", "/transfer/export-schedule");
      expect(delSched.status).toBe(200);
      expect(delSched.body.deleted).toBe(true);
    });

    // -------------------------------------------------------------------------
    // #307: Lean Preset, Module Toggles & Setup State
    // -------------------------------------------------------------------------
    it("#307 applies solo_founder and full presets non-destructively and persists setup state alongside lab toggles", async () => {
      // 1. Apply solo_founder preset
      const soloRes = await teamJson("POST", "/settings/preset", {
        body: { preset: "solo_founder" },
      });
      expect(soloRes.status).toBe(200);
      expect(soloRes.body.preset).toBe("solo_founder");
      expect(soloRes.body.modules).toEqual({
        feedback: true,
        roadmap: true,
        changelog: true,
        helpCenter: true,
        supportInbox: true,
        supportTickets: false,
        statusPage: false,
        surveys: false,
        ai: false,
      });

      // 2. Update setup state
      const setupPatch = await teamJson("PATCH", "/settings/setup-state", {
        body: {
          completedSteps: ["create_project", "install_widget"],
          dismissed: false,
        },
      });
      expect(setupPatch.status).toBe(200);
      expect(setupPatch.body.completedSteps).toEqual([
        "create_project",
        "install_widget",
      ]);

      // 3. Toggle an individual lab module (surveys: true) without clobbering preset/setupState
      const labRes = await teamJson("PUT", "/settings/labs", {
        body: { surveys: true },
      });
      expect(labRes.status).toBe(200);
      expect(labRes.body.surveys).toBe(true);
      expect(labRes.body.ai).toBe(false);

      const setupRead = await teamJson("GET", "/settings/setup-state");
      expect(setupRead.status).toBe(200);
      expect(setupRead.body.preset).toBe("solo_founder");
      expect(setupRead.body.completedSteps).toEqual([
        "create_project",
        "install_widget",
      ]);
      expect(setupRead.body.modules.surveys).toBe(true);

      // 4. Switch to full preset -> enables everything cleanly
      const fullRes = await teamJson("POST", "/settings/preset", {
        body: { preset: "full" },
      });
      expect(fullRes.status).toBe(200);
      expect(fullRes.body.modules.supportTickets).toBe(true);
      expect(fullRes.body.modules.ai).toBe(true);
      expect(fullRes.body.modules.statusPage).toBe(true);
    });
  },
);
