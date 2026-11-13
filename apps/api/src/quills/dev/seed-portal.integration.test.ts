import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../database/schema";
import { withQuillsWorkspace } from "../../database/quills/client";
import { statusIncidentComponents } from "../../database/quills/schema/status";
import { settings } from "../../database/quills/schema/auth";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { seedPortal } from "./seed-portal";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  getDatabase: () => drizzle(pool, { schema }),
  get schema() {
    return schema;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

describe.skipIf(!url)("portal demo seed integration", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("NODE_ENV", "test");
  }, 120000);
  afterAll(async () => {
    const db = drizzle(pool, { schema });
    const [workspace] = await db
      .select({ metadata: schema.workspaceTable.metadata })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, "quills_portal_demo"));
    if (
      workspace &&
      JSON.parse(workspace.metadata ?? "{}").fixture === "quills-portal-demo-v1"
    ) {
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, "quills_portal_demo"));
      await db
        .delete(schema.userTable)
        .where(eq(schema.userTable.id, "quills_portal_demo_user"));
    }
    vi.unstubAllEnvs();
    await stopContract();
  }, 60000);

  it("seeds a visible incident idempotently with a complete brand color pair", async () => {
    const identity = await seedPortal();
    await seedPortal();
    const response = await app.request(
      `/quills-public/${identity.workspaceId}/status`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body.activeIncidents).toHaveLength(1);
    expect(body.activeIncidents[0].title).toBe("Portal demo incident");
    expect(body.activeIncidents[0].affectedComponents).toHaveLength(1);
    expect(body.activeIncidents[0].affectedComponents[0].name).toBe("API");
    expect(body.topLevelStatus).toBe("degraded_performance");
    await withQuillsWorkspace(identity, async (db) => {
      expect(await db.select().from(statusIncidentComponents)).toHaveLength(1);
      const [row] = await db
        .select({ branding: settings.brandingConfig })
        .from(settings);
      expect(JSON.parse(row!.branding!).light).toMatchObject({
        primary: "oklch(0.55 0.2 260)",
        primaryForeground: "oklch(1 0 0)",
      });
    });
  });
});
