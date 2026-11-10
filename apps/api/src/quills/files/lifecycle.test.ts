import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { files } from "../../database/quills/schema/files";
import { apiRouter, type BaseVariables } from "../../openapi";
import { retryStorageCleanup } from "../../storage/cleanup-queue";
import {
  deleteS3Object,
  InvalidUploadedAssetError,
  verifyTaskAssetUpload,
} from "../../storage/s3";
import { listWorkspaceObjectKeys } from "../../workspace/lifecycle/list-workspace-object-keys";
import { buildQuillsRoute } from "../framework/define-route";
import { contentPurposes } from "../framework/files";
import {
  contractApp,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { registry } from "../framework/registry";
import quillsRouter from "../index";
import { fileRow, image } from "./seed.fixture";

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
// Object-store network calls only.
vi.mock("../../storage/s3", async (original) => ({
  ...(await original<typeof import("../../storage/s3")>()),
  verifyTaskAssetUpload: vi.fn(
    async (_key: string, expected: { size: number; contentType: string }) =>
      expected,
  ),
  getPrivateObject: vi.fn(async () => ({
    body: new Blob(["image"]).stream(),
  })),
  deleteS3Object: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const secret = "lifecycle-secret-value";
const app = contractApp(quillsRouter);
let env: ContractEnv;

type Method = "GET" | "POST" | "PUT" | "DELETE";
const call = async (
  method: Method,
  path: string,
  body?: unknown,
  target = app,
) => {
  const res = await target.request(`/quills/${env.a}${path}`, {
    method,
    headers: {
      "x-test-user": env.owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const upload = async (purpose: string) => {
  const res = await call(
    "POST",
    (contentPurposes as readonly string[]).includes(purpose)
      ? "/files/uploads"
      : "/files/settings-uploads",
    { purpose, filename: "image.png", ...image },
  );
  expect(res.status).toBe(200);
  return res.body.key as string;
};
const register = (key: string, target = app) =>
  call("POST", "/files", { key, name: "image.png", ...image }, target);
const setLogo = (key: string, target = app) =>
  call("PUT", "/settings/logo", { key, ...image }, target);

const queued = async (key: string) =>
  (
    await pool.query(
      "SELECT 1 FROM public.storage_cleanup WHERE object_key=$1",
      [key],
    )
  ).rowCount === 1;
const logoKey = async () =>
  (
    await pool.query(
      "SELECT logo_key FROM quills.settings WHERE workspace_id=$1",
      [env.a],
    )
  ).rows[0].logo_key as string | null;
const fileRows = async (key: string) =>
  (
    await pool.query(
      "SELECT count(*)::int n FROM quills.files WHERE storage_key=$1",
      [key],
    )
  ).rows[0].n as number;
const events = async () =>
  (
    await pool.query(
      "SELECT count(*)::int n FROM quills.events WHERE workspace_id=$1",
      [env.a],
    )
  ).rows[0].n as number;
/** Ends a verification lease early, as its expiry would. */
const expireLease = (key: string) =>
  pool.query("DELETE FROM public.job_lease WHERE name=$1", [
    `storage-verification:${key}`,
  ]);
/** Runs the shared cleanup worker until none of `keys` is queued. */
async function drain(keys: string[]) {
  for (let run = 0; run < 50; run++) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM public.storage_cleanup WHERE object_key = ANY($1::text[])",
      [keys],
    );
    if (!rowCount) return;
    await retryStorageCleanup();
  }
  throw new Error("Cleanup did not settle");
}
/** The declared route with a failure injected after its handler wrote. */
const failingApp = (operationId: string) => {
  const d = [...registry.keys()].find((r) => r.operationId === operationId)!;
  return contractApp(
    apiRouter<BaseVariables & { workspaceId: string }>().openapi(
      ...buildQuillsRoute({
        ...d,
        handler: async (input) => {
          await d.handler(input);
          throw new Error("Injected failure after the write");
        },
      }),
    ),
  );
};

describe.skipIf(!url)("Quills file lifecycle", () => {
  beforeAll(async () => {
    // Presigning is local; these values never reach a network.
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9");
    vi.stubEnv("S3_BUCKET", "quills-lifecycle");
    vi.stubEnv("S3_ACCESS_KEY_ID", "lifecycle");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", secret);
    vi.stubEnv("S3_KEY_PREFIX", "");
    pool = new Pool({ connectionString: url, max: 5 });
    env = await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopContract();
  });

  it("uploads, verifies and registers a file without exposing storage secrets", async () => {
    const res = await call("POST", "/files/uploads", {
      purpose: "file",
      filename: "notes.txt",
      contentType: "text/plain",
      size: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(
      new RegExp(`^workspace/${env.a}/quills/file/[a-z0-9]+\\.txt$`),
    );
    expect(res.body.uploadUrl).toContain("X-Amz-Signature=");
    expect(JSON.stringify(res.body)).not.toContain(secret);

    const created = await call("POST", "/files", {
      key: res.body.key,
      name: "notes.txt",
      contentType: "text/plain",
      size: 5,
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: "notes.txt",
      contentType: "text/plain",
      family: "text",
      size: 5,
    });
    expect(verifyTaskAssetUpload).toHaveBeenCalledWith(
      res.body.key,
      expect.objectContaining({ size: 5, contentType: "text/plain" }),
    );
    const [row] = await env.scoped(env.a, (db) =>
      db.select().from(files).where(eq(files.id, created.body.id)),
    );
    expect(row).toMatchObject({
      storageKey: res.body.key,
      sha256: createHash("sha256").update("image").digest("hex"),
    });
    expect(row!.uploadedById).toBeTruthy();
    expect(await listWorkspaceObjectKeys(env.a)).toContain(res.body.key);

    const read = await call("GET", `/files/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.downloadUrl).toContain("X-Amz-Signature=");
    expect(read.body.downloadUrl).toContain("attachment");
    expect(JSON.stringify(read.body)).not.toContain(secret);
    expect(read.body).not.toHaveProperty("storageKey");
  });

  it("rejects another workspace's key, another purpose's key and a path suffix", async () => {
    const before = await events();
    const keyOfB = `workspace/${env.b}/quills/file/abc.png`;
    const logo = await upload("logo");
    for (const key of [keyOfB, logo, `${await upload("file")}/../x.png`]) {
      expect((await register(key)).status).toBe(404);
      expect(await fileRows(key)).toBe(0);
    }
    expect((await setLogo(await upload("post_image"))).status).toBe(404);
    expect(await events()).toBe(before);
  });

  it("replaces and removes a settings key and queues the old key", async () => {
    const first = await upload("logo");
    expect((await setLogo(first)).body).toEqual({ changed: true });
    expect(await queued(first)).toBe(false);

    const second = await upload("logo");
    expect((await setLogo(second)).body).toEqual({ changed: true });
    expect(await logoKey()).toBe(second);
    expect(await queued(first)).toBe(true);

    // The verification lease outlives the request; a retry of the same key waits for it.
    expect((await setLogo(second)).status).toBe(503);
    await expireLease(second);
    const before = await events();
    expect((await setLogo(second)).body).toEqual({ changed: false });
    expect(await events()).toBe(before);

    await expireLease(first);
    await drain([first]);
    expect(deleteS3Object).toHaveBeenCalledWith(first);
    expect(deleteS3Object).not.toHaveBeenCalledWith(second);

    expect((await call("DELETE", "/settings/logo")).body).toEqual({
      changed: true,
    });
    expect(await logoKey()).toBeNull();
    expect(await queued(second)).toBe(true);
    expect((await call("DELETE", "/settings/logo")).body).toEqual({
      changed: false,
    });
    await expireLease(second);
    await drain([second]);
    expect(deleteS3Object).toHaveBeenCalledWith(second);
  });

  it("does not commit a reference after the verification lease expires", async () => {
    const key = await upload("file"),
      logo = await upload("logo");
    const before = await events();
    const current = await logoKey();
    const now = Date.now;
    // The lease starts before verification; the clock passes its end while the object is checked.
    const expired = async (send: () => ReturnType<typeof call>) => {
      let clock: { mockRestore: () => void } | undefined;
      vi.mocked(verifyTaskAssetUpload).mockImplementationOnce(
        async (_key, expected) => {
          clock = vi
            .spyOn(Date, "now")
            .mockImplementation(() => now() + 61_000);
          return expected;
        },
      );
      try {
        return await send();
      } finally {
        clock?.mockRestore();
      }
    };
    for (const res of [
      await expired(() => register(key)),
      await expired(() => setLogo(logo)),
    ]) {
      expect(res.status).toBe(503);
      expect(res.body.message).toContain("expired");
    }
    expect(await fileRows(key)).toBe(0);
    expect(await logoKey()).toBe(current);
    expect(await events()).toBe(before);
  });

  it("keeps a queued key while its upload is verified and after the reference commits", async () => {
    const key = await upload("file");
    await pool.query(
      "INSERT INTO public.storage_cleanup(object_key) VALUES ($1)",
      [key],
    );
    let started!: () => void, finish!: () => void;
    const verifying = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (finish = resolve));
    vi.mocked(verifyTaskAssetUpload).mockImplementationOnce(
      async (_key, expected) => {
        started();
        await gate;
        return expected;
      },
    );
    const pending = register(key);
    await verifying;
    await retryStorageCleanup();
    expect(deleteS3Object).not.toHaveBeenCalledWith(key);
    expect(await queued(key)).toBe(true);
    finish();
    expect((await pending).status).toBe(200);

    await expireLease(key);
    await drain([key]);
    expect(deleteS3Object).not.toHaveBeenCalledWith(key);
  });

  it("keeps an object that another workspace still references", async () => {
    const key = await upload("logo");
    expect((await setLogo(key)).status).toBe(200);
    await fileRow(env, env.b, key);
    expect((await call("DELETE", "/settings/logo")).body.changed).toBe(true);
    expect(await queued(key)).toBe(true);
    await expireLease(key);
    await drain([key]);
    expect(deleteS3Object).not.toHaveBeenCalledWith(key);

    await env.scoped(env.b, (db) =>
      db.delete(files).where(eq(files.storageKey, key)),
    );
    await drain([key]);
    expect(deleteS3Object).toHaveBeenCalledWith(key);
  });

  it("releases the lease when verification fails", async () => {
    const key = await upload("file");
    vi.mocked(verifyTaskAssetUpload).mockRejectedValueOnce(
      new InvalidUploadedAssetError("Uploaded object was not found."),
    );
    expect((await register(key)).status).toBe(400);
    expect(
      (
        await pool.query("SELECT 1 FROM public.job_lease WHERE name=$1", [
          `storage-verification:${key}`,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await register(key)).status).toBe(200);
  });

  it("leaves no reference, event or cleanup row when the request fails after the write", async () => {
    const before = await events();
    const key = await upload("file");
    expect((await register(key, failingApp("createQuillsFiles"))).status).toBe(
      500,
    );
    expect(await fileRows(key)).toBe(0);

    const first = await upload("logo");
    expect((await setLogo(first)).status).toBe(200);
    const after = await events();
    const second = await upload("logo");
    expect(
      (await setLogo(second, failingApp("saveQuillsLogoKey"))).status,
    ).toBe(500);
    expect(await logoKey()).toBe(first);
    expect(await queued(first)).toBe(false);
    expect(await events()).toBe(after);
    expect(after).toBe(before + 1);
  });
});
