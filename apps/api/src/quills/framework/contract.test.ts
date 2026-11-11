import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import * as contentFixtures from "../content/index.fixture";
import * as deliveryFixtures from "../delivery/index.fixture";
import publicRouter from "../public";
import * as directoryFixtures from "../directory/index.fixture";
import * as feedbackFixtures from "../feedback/core.fixture";
import * as fileFixtures from "../files/routes.fixture";
import * as contextFixtures from "../index.fixture";
import * as integrationFixtures from "../integrations/index.fixture";
import * as jobFixtures from "../jobs/routes.fixture";
import * as linkFixtures from "../links.fixture";
import * as portalFixtures from "../portal/index.fixture";
import * as operationsFixtures from "../operations/index.fixture";
import * as reportingFixtures from "../reporting/index.fixture";
import * as settingsFixtures from "../settings/index.fixture";
import * as teamFixtures from "../teams.fixture";
import * as taxonomyFixtures from "../feedback/taxonomy.fixture";
import * as widgetFixtures from "../widget/index.fixture";
import * as ticketFixtures from "../support/tickets-router.fixture";
import * as supportFixtures from "../support/index.fixture";
import {
  checkRoute,
  contractApp,
  contractSession,
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
// Object-store network calls only: an upload exists with its declared size and type.
vi.mock("../../storage/s3", async (original) => ({
  ...(await original<typeof import("../../storage/s3")>()),
  verifyTaskAssetUpload: vi.fn(
    async (_key: string, expected: { size: number; contentType: string }) =>
      expected,
  ),
}));
// The upload digest reads through its own client: answer that GET with the stored bytes.
vi.spyOn(S3Client.prototype, "send").mockImplementation((async (
  command: unknown,
) => {
  if (!(command instanceof GetObjectCommand))
    throw new Error("Unexpected storage call");
  return { Body: Readable.from([Buffer.from("image")]) };
}) as never);
// Portal routes read the Kaneo session; the contract signs in the x-test-user account instead.
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const fixtures: Record<string, Fixture> = {
  ...contextFixtures,
  ...fileFixtures,
  ...feedbackFixtures,
  ...deliveryFixtures,
  ...jobFixtures,
  ...linkFixtures,
  ...teamFixtures,
  ...directoryFixtures,
  ...settingsFixtures,
  ...taxonomyFixtures,
  ...portalFixtures,
  ...widgetFixtures,
  ...contentFixtures,
  ...integrationFixtures,
  ...operationsFixtures,
  ...ticketFixtures,
  ...supportFixtures,
  ...reportingFixtures,
};
const app = contractApp(quillsRouter, publicRouter);

describe.skipIf(!url)("Quills route contract", () => {
  beforeAll(async () => {
    // Presigning is local; these values never reach a network.
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9");
    vi.stubEnv("S3_BUCKET", "quills-contract");
    vi.stubEnv("S3_ACCESS_KEY_ID", "contract");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "contract-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopContract();
  });

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
