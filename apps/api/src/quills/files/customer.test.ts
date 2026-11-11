import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toUuid, type TypeId } from "@kaneo/ids";
import { settings } from "../../database/quills/schema/auth";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { enablePortal } from "../portal/seed.fixture";
import { image } from "./seed.fixture";

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
vi.spyOn(S3Client.prototype, "send").mockImplementation((async (
  command: unknown,
) => {
  if (!(command instanceof GetObjectCommand))
    throw new Error("Unexpected storage call");
  return { Body: Readable.from([Buffer.from("image")]) };
}) as never);
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

/** A portal request as `user`, or a widget request with `bearer`. */
async function call(
  method: string,
  path: string,
  options: { user?: string; bearer?: string; body?: unknown } = {},
) {
  const res = await app.request(`/quills-public/${contractEnv().a}${path}`, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
      "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: await res.json() };
}
const queued = async (key: string) =>
  (
    await pool.query(
      "SELECT 1 FROM public.storage_cleanup WHERE object_key=$1",
      [key],
    )
  ).rowCount === 1;
/** The avatar key on the customer profile of a Kaneo account in A. */
const avatarKey = async (userId: string) =>
  (
    await pool.query(
      "SELECT image_key FROM quills.customer_identity WHERE workspace_id=$1 AND kaneo_user_id=$2",
      [contractEnv().a, userId],
    )
  ).rows[0]?.image_key as string | null;
const fileRows = async (key: string) =>
  (
    await pool.query(
      "SELECT count(*)::int AS n FROM quills.files WHERE storage_key=$1",
      [key],
    )
  ).rows[0].n as number;
const setPortal = (config: object) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.update(settings).set({ portalConfig: JSON.stringify(config) }),
  );
const setWidget = (config: object) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.update(settings).set({ widgetConfig: JSON.stringify(config) }),
  );

describe.skipIf(!url)("Quills portal and widget uploads", () => {
  beforeAll(async () => {
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9");
    vi.stubEnv("S3_BUCKET", "quills-customer");
    vi.stubEnv("S3_ACCESS_KEY_ID", "customer");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "customer-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
    pool = new Pool({ connectionString: url, max: 5 });
    const env = await startContract(pool, url!);
    await enablePortal(env, env.a);
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopContract();
  });

  it("registers a customer's own upload once and refuses it to another customer", async () => {
    const env = contractEnv();
    const a = await env.portalCustomer(env.a, env.customerA);
    // Customer B has no profile here yet: no upload URL (the source's 403).
    const none = await call("POST", "/portal/uploads", {
      user: env.customerB,
      body: { purpose: "customer_file", filename: "a.pdf", ...image },
    });
    expect(none.status).toBe(403);
    await env.portalCustomer(env.a, env.customerB);

    const upload = await call("POST", "/portal/uploads", {
      user: env.customerA,
      body: { purpose: "customer_image", filename: "a.png", ...image },
    });
    expect(upload.status).toBe(200);
    expect(upload.body.key).toContain(
      `/quills/customer_image/${a.customerId}/`,
    );
    const body = { key: upload.body.key, name: "a.png", ...image };
    const stolen = await call("POST", "/portal/files", {
      user: env.customerB,
      body,
    });
    expect(stolen.status).toBe(404);
    const first = await call("POST", "/portal/files", {
      user: env.customerA,
      body,
    });
    expect(first.body).toMatchObject({ created: true, name: "a.png" });
    // The verification lease outlives the commit for 60 s (framework/files.ts); end it as expiry would.
    await pool.query("DELETE FROM public.job_lease WHERE name=$1", [
      `storage-verification:${upload.body.key}`,
    ]);
    const retry = await call("POST", "/portal/files", {
      user: env.customerA,
      body,
    });
    expect(retry.body).toMatchObject({ id: first.body.id, created: false });

    // A widget visitor's upload: another visitor of the same workspace cannot register it.
    const visitor = await env.widgetVisitor(env.a);
    const other = await env.widgetVisitor(env.a);
    const widgetUpload = await call("POST", "/widget/uploads", {
      bearer: visitor.token,
      body: {
        purpose: "customer_file",
        filename: "notes.txt",
        contentType: "text/plain",
        size: 10,
      },
    });
    expect(widgetUpload.status).toBe(200);
    const widgetBody = {
      key: widgetUpload.body.key,
      name: "notes.txt",
      contentType: "text/plain",
      size: 10,
    };
    expect(
      (
        await call("POST", "/widget/files", {
          bearer: other.token,
          body: widgetBody,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("POST", "/widget/files", {
          bearer: visitor.token,
          body: widgetBody,
        })
      ).body,
    ).toMatchObject({ created: true });
  });

  it("bounds content types per purpose", async () => {
    const env = contractEnv();
    await env.portalCustomer(env.a, env.customerA);
    const upload = (purpose: string, contentType: string) =>
      call("POST", "/portal/uploads", {
        user: env.customerA,
        body: { purpose, filename: "x", contentType, size: 10 },
      });
    expect((await upload("customer_file", "text/html")).status).toBe(400);
    expect((await upload("customer_file", "image/svg+xml")).status).toBe(400);
    expect((await upload("customer_image", "application/pdf")).status).toBe(
      400,
    );
    expect((await upload("customer_avatar", "application/pdf")).status).toBe(
      400,
    );
    expect((await upload("customer_file", "application/pdf")).status).toBe(200);
  });

  it("sets, replaces and removes the caller's avatar, and queues the old object", async () => {
    const env = contractEnv();
    await env.portalCustomer(env.a, env.customerA);
    const newAvatar = async () => {
      const upload = await call("POST", "/portal/uploads", {
        user: env.customerA,
        body: { purpose: "customer_avatar", filename: "me.png", ...image },
      });
      return upload.body.key as string;
    };
    const first = await newAvatar();
    // An attachment key is not an avatar key.
    const attachment = (
      await call("POST", "/portal/uploads", {
        user: env.customerA,
        body: { purpose: "customer_image", filename: "x.png", ...image },
      })
    ).body.key as string;
    expect(
      (
        await call("PUT", "/user/avatar", {
          user: env.customerA,
          body: { key: attachment, ...image },
        })
      ).status,
    ).toBe(404);

    const saved = await call("PUT", "/user/avatar", {
      user: env.customerA,
      body: { key: first, ...image },
    });
    expect(saved.body.changed).toBe(true);
    expect(saved.body.avatarUrl).toContain(first);
    expect(await avatarKey(env.customerA)).toBe(first);
    const profile = await call("GET", "/user/profile", { user: env.customerA });
    expect(profile.body.avatarUrl).toContain(first);

    const second = await newAvatar();
    await call("PUT", "/user/avatar", {
      user: env.customerA,
      body: { key: second, ...image },
    });
    expect(await queued(first)).toBe(true);
    const removed = await call("DELETE", "/user/avatar", {
      user: env.customerA,
    });
    expect(removed.body).toMatchObject({ changed: true, avatarUrl: null });
    expect(await avatarKey(env.customerA)).toBeNull();
    expect(await queued(second)).toBe(true);
  });

  it("closes portal uploads to a caller that a private portal does not admit", async () => {
    const env = contractEnv();
    const a = await env.portalCustomer(env.a, env.customerA);
    const upload = await call("POST", "/portal/uploads", {
      user: env.customerA,
      body: { purpose: "customer_image", filename: "a.png", ...image },
    });
    expect(upload.status).toBe(200);
    await setPortal({ enabled: true, access: { visibility: "private" } });
    try {
      expect(
        (
          await call("POST", "/portal/uploads", {
            user: env.customerA,
            body: { purpose: "customer_image", filename: "b.png", ...image },
          })
        ).status,
      ).toBe(403);
      const body = { key: upload.body.key, name: "a.png", ...image };
      expect(
        (await call("POST", "/portal/files", { user: env.customerA, body }))
          .status,
      ).toBe(403);
      expect(await fileRows(upload.body.key)).toBe(0);
    } finally {
      await setPortal({ enabled: true });
    }
    expect(a.customerId).toBeTruthy();
  });

  it("refuses widget uploads from an anonymous session or with the support tabs off", async () => {
    const env = contractEnv();
    const visitor = await env.widgetVisitor(env.a);
    const request = {
      purpose: "customer_file",
      filename: "a.txt",
      contentType: "text/plain",
      size: 5,
    };
    const anonymous = await call("POST", "/widget/anonymous-session");
    expect(anonymous.status).toBe(200);
    expect(
      (
        await call("POST", "/widget/uploads", {
          bearer: anonymous.body.sessionToken,
          body: request,
        })
      ).status,
    ).toBe(403);
    await setWidget({
      enabled: true,
      tabs: { messenger: false, tickets: false },
    });
    try {
      expect(
        (
          await call("POST", "/widget/uploads", {
            bearer: visitor.token,
            body: request,
          })
        ).status,
      ).toBe(404);
    } finally {
      await setWidget({ enabled: true });
    }
    expect(
      (
        await call("POST", "/widget/uploads", {
          bearer: visitor.token,
          body: request,
        })
      ).status,
    ).toBe(200);
  });

  it("answers 403, not 500, to a removed customer that keeps its profile row", async () => {
    const env = contractEnv();
    // Customer B has written nothing that refers to its principal.
    const b = await env.portalCustomer(env.a, env.customerB);
    const upload = await call("POST", "/portal/uploads", {
      user: env.customerB,
      body: { purpose: "customer_avatar", filename: "me.png", ...image },
    });
    // "Remove a customer" deletes the principal and keeps the customer row.
    await pool.query(
      "DELETE FROM quills.principal WHERE workspace_id=$1 AND id=$2",
      [env.a, toUuid(b.principalId as TypeId<"principal">)],
    );
    await pool.query(
      "UPDATE quills.customer_identity SET image_key=$3 WHERE workspace_id=$1 AND kaneo_user_id=$2",
      [env.a, env.customerB, `${upload.body.key}-earlier`],
    );
    const before = await avatarKey(env.customerB);
    expect(before).toBe(`${upload.body.key}-earlier`);
    const saved = await call("PUT", "/user/avatar", {
      user: env.customerB,
      body: { key: upload.body.key, ...image },
    });
    expect(saved.status).toBe(403);
    const deleted = await call("DELETE", "/user/avatar", {
      user: env.customerB,
    });
    expect(deleted.body).toMatchObject({ changed: false });
    expect(await avatarKey(env.customerB)).toBe(before);
  });
});
