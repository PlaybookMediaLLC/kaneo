import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { integrations } from "../../../database/quills/schema/integrations";
import * as kaneo from "../../../database/schema";
import { decryptSecret } from "../../../notification-preferences/secrets";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import { oauthConnection } from "../oauth-seed.fixture";
import { providerCalls, providerOverrides } from "../provider-edge.fixture";
import "./azure-devops.fixture";

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
vi.mock("../../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;

const projectsPath = "/dev.azure.com/contract/_apis/projects";
const basic = (token: string) =>
  `Basic ${Buffer.from(`:${token}`).toString("base64")}`;
type IntegrationId = typeof integrations.$inferSelect.id;

describe.skipIf(!url)(
  "Azure DevOps provider with the local provider server",
  () => {
    const app = contractApp(quillsRouter, publicRouter);
    const as = (userId: string) => ({ headers: { "x-test-user": userId } });
    const env = () => contractEnv();
    const save = (body: unknown) =>
      app.request(`/quills/${env().a}/integrations/azure-devops/connection`, {
        method: "PUT",
        headers: {
          "x-test-user": env().owner,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const destinations = (id: IntegrationId, query = "") =>
      app.request(
        `/quills/${env().a}/integrations/${id}/destinations${query}`,
        as(env().owner),
      );
    const rows = () =>
      env().scoped(env().a, (db) =>
        db
          .select({
            config: integrations.config,
            secrets: integrations.secrets,
          })
          .from(integrations)
          .where(eq(integrations.integrationType, "azure_devops")),
      );
    const disconnected = () =>
      env().scoped(env().a, (db) =>
        db
          .delete(integrations)
          .where(eq(integrations.integrationType, "azure_devops")),
      );
    const connected = (organization: string) =>
      oauthConnection(env(), env().a, {
        type: "azure_devops",
        config: { organization },
      });

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
    }, 120000);
    afterAll(() => stopContract());
    afterEach(() => {
      providerOverrides.clear();
      providerCalls.length = 0;
    });

    it("connects with a personal access token that lists the organization's projects", async () => {
      await disconnected();
      const res = await save({
        token: "contract-pat",
        organization: "contract",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        integration: {
          integrationType: "azure_devops",
          workspaceName: "contract",
          account: "dev.azure.com/contract",
        },
      });
      expect(JSON.stringify(body)).not.toContain("contract-pat");
      expect(providerCalls).toEqual([
        expect.objectContaining({
          method: "GET",
          path: `${projectsPath}?api-version=7.1`,
          authorization: basic("contract-pat"),
        }),
      ]);
      const [row] = await rows();
      expect(row!.config).toMatchObject({ organization: "contract" });
      expect(JSON.parse(decryptSecret(row!.secrets)!)).toEqual({
        accessToken: "contract-pat",
      });
    });

    it("refuses a bad organization name before any call", async () => {
      await disconnected();
      for (const organization of [
        "",
        "-contract",
        "contract-",
        "evil.example.com",
        "contract/../x",
        "contract%2F..",
        "contract x",
        "contract?x=1",
        "contract#x",
        "a".repeat(51),
      ])
        expect(
          (await save({ token: "contract-pat", organization })).status,
          organization,
        ).toBe(400);
      expect(providerCalls).toEqual([]);
      expect(await rows()).toEqual([]);
    });

    it("refuses a token that Azure DevOps rejects, with a fixed message", async () => {
      await disconnected();
      for (const status of [401, 403]) {
        providerOverrides.set(`GET ${projectsPath}`, {
          status,
          body: { message: "provider detail" },
        });
        const res = await save({
          token: "contract-pat",
          organization: "contract",
        });
        expect(res.status, String(status)).toBe(400);
        expect(await res.json()).toMatchObject({
          message: "The provider rejected the request.",
        });
      }
      providerOverrides.set(`GET ${projectsPath}`, "drop");
      expect(
        (await save({ token: "contract-pat", organization: "contract" }))
          .status,
      ).toBe(502);
      expect(await rows()).toEqual([]);
    });

    it("lists projects and work item types, and refuses a project that it does not list", async () => {
      const id = await connected("contract");
      for (const query of ["", "?kind=project"]) {
        const res = await destinations(id, query);
        expect(res.status, query).toBe(200);
        expect(await res.json()).toEqual({
          destinations: [{ id: "Contract App", name: "Contract App" }],
        });
      }
      providerCalls.length = 0;
      const types = await destinations(
        id,
        "?kind=work-item-type&parent=Contract%20App",
      );
      expect(types.status).toBe(200);
      expect(await types.json()).toEqual({
        destinations: [
          { id: "Bug", name: "Bug" },
          { id: "User Story", name: "User Story" },
        ],
      });
      expect(providerCalls.map((call) => call.path)).toEqual([
        `${projectsPath}?api-version=7.1`,
        "/dev.azure.com/contract/Contract%20App/_apis/wit/workitemtypes?api-version=7.1",
      ]);
      expect(providerCalls[1]!.authorization).toBe(
        basic(`gho_seeded_${env().a}`),
      );

      providerCalls.length = 0;
      const foreign = await destinations(
        id,
        "?kind=work-item-type&parent=Other%20Project",
      );
      expect(foreign.status).toBe(404);
      expect(providerCalls.map((call) => call.path)).toEqual([
        `${projectsPath}?api-version=7.1`,
      ]);
      for (const query of [
        "?kind=work-item-type",
        "?kind=project&parent=Contract%20App",
        "?kind=work-item-type&parent=..%2Fx",
      ])
        expect((await destinations(id, query)).status, query).toBe(400);
    });

    it("refuses a stored organization that does not match before any call", async () => {
      const id = await connected("evil.example.com/x");
      expect((await destinations(id)).status).toBe(409);
      expect(providerCalls).toEqual([]);
    });

    it("answers a fixed error for a malformed provider answer", async () => {
      await disconnected();
      providerOverrides.set(`GET ${projectsPath}`, {
        status: 200,
        body: "provider detail",
      });
      const res = await save({
        token: "contract-pat",
        organization: "contract",
      });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({
        message: "The provider could not be reached. Try again.",
      });
      expect(await rows()).toEqual([]);

      const id = await connected("contract");
      providerOverrides.set(`GET ${projectsPath}`, {
        status: 200,
        body: { value: "provider detail" },
      });
      const list = await destinations(id);
      expect(list.status).toBe(502);
      expect(await list.text()).not.toContain("provider detail");
    });

    it("has no OAuth connect route and no OAuth app credentials", async () => {
      expect(
        (
          await app.request(
            `/quills/${env().a}/oauth/azure_devops/connect`,
            as(env().owner),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            `/quills/${env().a}/integration-platform-credentials?type=azure_devops`,
            as(env().owner),
          )
        ).status,
      ).toBe(400);
    });
  },
);
