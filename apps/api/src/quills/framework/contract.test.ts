import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import * as deliveryFixtures from "../delivery/index.fixture";
import * as contextFixtures from "../index.fixture";
import * as jobFixtures from "../jobs/routes.fixture";
import * as linkFixtures from "../links.fixture";
import * as teamFixtures from "../teams.fixture";
import {
  checkRoute,
  contractApp,
  startContract,
  stopContract,
  unregisteredRoutes,
  type Fixture,
} from "./contract";
import { registry } from "./registry";

let pool: Pool;
vi.mock("../../database/index", () => ({
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
const url = process.env.QUILLS_TEST_DATABASE_URL;
const fixtures: Record<string, Fixture> = {
  ...contextFixtures,
  ...deliveryFixtures,
  ...jobFixtures,
  ...linkFixtures,
  ...teamFixtures,
};
const app = contractApp(quillsRouter);

describe.skipIf(!url)("Quills route contract", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("mounts every Quills route through defineQuillsRoute", () => {
    expect(registry.size).toBeGreaterThan(0);
    expect(unregisteredRoutes(app)).toEqual([]);
  });
  it.each([...registry.keys()].map((d) => [d.operationId, d] as const))(
    "%s passes every contract check",
    async (operationId, d) => {
      expect(await checkRoute(app, d, fixtures[operationId])).toEqual([]);
    },
    60000,
  );
});
