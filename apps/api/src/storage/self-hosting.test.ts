import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../database/schema";
import { runQuillsMigrations } from "../database/quills/migrate";
import { probeDoctor } from "../admin/system/probe-doctor";
import { probeStorage } from "../admin/system/probe-storage";
import {
  deleteLocalObject,
  getLocalObject,
  headLocalObject,
  localStorageRoutes,
  probeLocalStorage,
  putLocalObject,
  resolveLocalStoragePath,
  signLocalStorageToken,
  verifyLocalStorageToken,
} from "./local-driver";

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

const url = process.env.QUILLS_TEST_DATABASE_URL;

describe("Zero-S3 local filesystem storage driver (#303)", () => {
  let tmpDir: string;
  const prevDriver = process.env.STORAGE_DRIVER;
  const prevDir = process.env.LOCAL_STORAGE_DIR;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "kaneo-local-store-"));
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = tmpDir;
  });

  afterAll(async () => {
    if (prevDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = prevDriver;
    if (prevDir === undefined) delete process.env.LOCAL_STORAGE_DIR;
    else process.env.LOCAL_STORAGE_DIR = prevDir;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("blocks path traversal, null bytes, and absolute paths", () => {
    expect(() => resolveLocalStoragePath("../etc/passwd", tmpDir)).toThrow();
    expect(() =>
      resolveLocalStoragePath("workspace/../../secret", tmpDir),
    ).toThrow();
    expect(() => resolveLocalStoragePath("/etc/passwd", tmpDir)).toThrow();
    expect(() =>
      resolveLocalStoragePath("workspace/a\0b.png", tmpDir),
    ).toThrow();
    const ok = resolveLocalStoragePath("workspace/ws1/file.txt", tmpDir);
    expect(ok.startsWith(tmpDir)).toBe(true);
  });

  it("performs atomic put/head/get/delete and probes writeability", async () => {
    await probeLocalStorage(tmpDir);
    const key = "workspace/ws-1/quills/export/report.txt";
    await putLocalObject(key, "hello self-hosted world", "text/plain", tmpDir);

    const head = await headLocalObject(key, tmpDir);
    expect(head?.size).toBe(23);
    expect(head?.contentType).toBe("text/plain");

    const obj = await getLocalObject(key, tmpDir);
    expect(obj?.body.toString("utf8")).toBe("hello self-hosted world");

    await deleteLocalObject(key, tmpDir);
    expect(await headLocalObject(key, tmpDir)).toBeNull();
  });

  it("enforces HMAC token signatures, expiry, and serves signed HTTP upload/download routes", async () => {
    const key = "workspace/ws-http/quills/file/sample.txt";
    const uploadToken = signLocalStorageToken(
      {
        op: "upload",
        key,
        contentType: "text/plain",
        maxBytes: 1024,
      },
      120,
    );

    // Tampered token fails
    expect(() => verifyLocalStorageToken(`${uploadToken}x`)).toThrow();

    // Expired token fails
    const expired = signLocalStorageToken({ op: "download", key }, -10);
    expect(() => verifyLocalStorageToken(expired)).toThrow();

    // Valid PUT upload
    const putRes = await localStorageRoutes.request(`/upload/${uploadToken}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "uploaded via signed local route",
    });
    expect(putRes.status).toBe(200);

    // Valid GET download
    const dlToken = signLocalStorageToken(
      {
        op: "download",
        key,
        contentType: "text/plain",
        disposition: 'attachment; filename="sample.txt"',
      },
      120,
    );
    const getRes = await localStorageRoutes.request(`/object/${dlToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await getRes.text()).toBe("uploaded via signed local route");

    // probeStorage succeeds on local driver
    const storageProbe = await probeStorage(3_000);
    expect(storageProbe).toEqual({
      status: "ok",
      configured: true,
      errorCode: null,
    });
  });
});

describe.skipIf(!url)(
  "Self-hosting rollback safety & Doctor probes (#303, real PostgreSQL)",
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("survives forward-expanded rollback in runQuillsMigrations without crashing, while rejecting tampered hashes", async () => {
      const migrationsDir = new URL("../../drizzle/quills", import.meta.url)
        .pathname;
      // Ensure DB is migrated to current latest
      await runQuillsMigrations(url!, migrationsDir);

      // Simulate a newer release having applied an extra expand-only migration (timestamp in future)
      const futureMillis = Date.now() + 86_400_000;
      await pool.query(
        "INSERT INTO quills_migrations.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        ["future-expand-only-migration-hash", futureMillis],
      );

      try {
        // Older app version (current bundled migrations) MUST boot cleanly in rollback compatibility mode!
        await expect(
          runQuillsMigrations(url!, migrationsDir),
        ).resolves.toBeUndefined();
      } finally {
        await pool.query(
          "DELETE FROM quills_migrations.__drizzle_migrations WHERE created_at = $1",
          [futureMillis],
        );
      }
    }, 60_000);

    it("reports actionable Doctor checks including pgvector without leaking secrets", async () => {
      const checks = await probeDoctor(3_000, {
        email: { status: "not_configured", configured: false },
        storage: { status: "ok", configured: true },
      });
      const pgv = checks.find((c) => c.id === "pgvector");
      expect(pgv?.status).toBe("ok");
      expect(pgv?.detail).toContain("pgvector");
      expect(checks.map((c) => c.id)).toEqual([
        "public_url",
        "pgvector",
        "storage",
        "email",
        "inbound_email",
        "ai_provider",
      ]);
    });
  },
);
