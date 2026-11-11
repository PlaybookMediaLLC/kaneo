import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { apiRouter, type BaseVariables } from "../../openapi";
import { retryStorageCleanup } from "../../storage/cleanup-queue";
import { deleteS3Object, verifyTaskAssetUpload } from "../../storage/s3";
import {
  contractApp,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { buildQuillsRoute } from "../framework/define-route";
import { verifyUpload } from "../framework/files";
import { registry } from "../framework/registry";
import quillsRouter from "../index";
import {
  brandColor,
  fetchWebsiteBranding,
  imageSize,
  readHead,
} from "./website-fetch";

// Website branding against a local stub server: the guard, the offer flow and the storage lifecycle.
// No request leaves this machine. DNS answers come from the table below, and every request that
// passes the guard goes to the stub, which records it. A guard failure would show as a recorded request.

const stub = vi.hoisted(() => ({ port: 0 }));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const address = (
      {
        "brand.example": "93.184.216.34",
        "redirect.example": "93.184.216.34",
        "metadata.example": "93.184.216.34",
        "rebind.example": "93.184.216.34",
        "port.example": "93.184.216.34",
        "example.test": "93.184.216.34",
        "internal.example": "10.0.0.7",
      } as Record<string, string>
    )[host];
    if (!address)
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return [{ address, family: 4 }];
  }),
}));
// The socket step after the guard: send the request to the stub and name the host it was for.
vi.mock("../../import/destination-fetch", () => ({
  destinationFetch: async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    headers.set("x-test-host", url.hostname);
    return fetch(`http://127.0.0.1:${stub.port}${url.pathname}`, {
      ...init,
      headers,
    });
  },
}));

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
// Object-store calls only: the HEAD check of an upload and the delete of the cleanup worker.
vi.mock("../../storage/s3", async (original) => ({
  ...(await original<typeof import("../../storage/s3")>()),
  verifyTaskAssetUpload: vi.fn(
    async (_key: string, expected: { size: number; contentType: string }) =>
      expected,
  ),
  deleteS3Object: vi.fn(async () => {}),
}));
// The real verification, wrapped so one test can let its deadline pass before the handler runs.
vi.mock("../framework/files", async (original) => {
  const files = await original<typeof import("../framework/files")>();
  return { ...files, verifyUpload: vi.fn(files.verifyUpload) };
});

/** A PNG header that declares `side` x `side` pixels. */
function png(side: number) {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(side, 16);
  bytes.writeUInt32BE(side, 20);
  return bytes;
}
const page = `<html><head><title>Acme</title>
<meta name="theme-color" content="#2563eb">
<link rel="icon" type="image/png" sizes="192x192" href="/icon.png">
</head><body>Acme</body></html>`;

/** Requests the stub received, as `METHOD host/path`. */
const received: string[] = [];
/** Runs while the stub holds a home page request, before it answers. */
let beforePage: (() => Promise<void>) | undefined;
let server: Server;
type Answer = {
  status: number;
  headers?: Record<string, string>;
  type?: string;
  body?: string | Buffer;
};
const respond = async (host: string, path: string): Promise<Answer> => {
  const redirects: Record<string, string> = {
    // Port 80: only the guard refuses this hop, not the standard-port rule.
    "redirect.example": "http://127.0.0.1/secret",
    "metadata.example": "http://169.254.169.254/latest/meta-data/",
    "rebind.example": "http://internal.example/",
    // A public host on another port: only the standard-port rule refuses this hop.
    "port.example": "https://brand.example:8443/",
  };
  if (path === "/" && redirects[host])
    return { status: 302, headers: { location: redirects[host] } };
  if (path === "/") {
    await beforePage?.();
    return { status: 200, type: "text/html; charset=utf-8", body: page };
  }
  if (path === "/icon.png")
    return { status: 200, type: "image/png", body: png(192) };
  return { status: 404 };
};

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter);
let env: ContractEnv;
const send = async (
  target: typeof app,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => {
  const res = await target.request(
    `/quills/${env.a}/settings/website-branding${path}`,
    {
      method,
      headers: {
        "x-test-user": env.owner,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return { status: res.status, body: await res.json() };
};
const call = (method: "GET" | "POST", path: string, body?: unknown) =>
  send(app, method, path, body);
const row = async () =>
  (
    await pool.query(
      "SELECT logo_key, branding_config, custom_css, metadata FROM quills.settings WHERE workspace_id=$1",
      [env.a],
    )
  ).rows[0] as {
    logo_key: string | null;
    branding_config: string | null;
    custom_css: string | null;
    metadata: string | null;
  };
const state = async () =>
  JSON.parse((await row()).metadata ?? "{}").brandingLookup;
const offerKey = async () => (await state())?.offer?.logoKey as string;
/** The key of the one logo the stub received in this test. */
const putKey = () => {
  const puts = received.filter((line) => line.startsWith("PUT"));
  expect(puts).toHaveLength(1);
  return puts[0]!.slice("PUT /quills-website/".length);
};
const fileRows = async (key: string) =>
  (
    await pool.query(
      "SELECT count(*)::int n FROM quills.files WHERE workspace_id=$1 AND storage_key=$2",
      [env.a, key],
    )
  ).rows[0].n as number;
const queued = async (key: string) =>
  (
    await pool.query(
      "SELECT 1 FROM public.storage_cleanup WHERE object_key=$1",
      [key],
    )
  ).rowCount === 1;
const leased = async (key: string) =>
  (
    await pool.query("SELECT 1 FROM public.job_lease WHERE name=$1", [
      `storage-verification:${key}`,
    ])
  ).rowCount === 1;
const events = async (type: string) =>
  (
    await pool.query(
      "SELECT count(*)::int n FROM quills.events WHERE workspace_id=$1 AND type=$2",
      [env.a, type],
    )
  ).rows[0].n as number;
/** Ends a verification lease early, as its expiry would. */
const expireLease = (key: string) =>
  pool.query("DELETE FROM public.job_lease WHERE name=$1", [
    `storage-verification:${key}`,
  ]);
/** Runs the shared cleanup worker until `key` is no longer queued. */
async function drain(key: string) {
  for (let run = 0; run < 50 && (await queued(key)); run++)
    await retryStorageCleanup();
  expect(await queued(key)).toBe(false);
}
/** No lookup state, no logo and the default theme, as a teammate could set by hand. */
const reset = () =>
  pool.query(
    `UPDATE quills.settings SET logo_key=NULL, branding_config=NULL, custom_css=NULL,
       metadata=(coalesce(nullif(metadata, ''), '{}')::jsonb - 'brandingLookup')::text
     WHERE workspace_id=$1`,
    [env.a],
  );

beforeAll(async () => {
  server = createServer((req, res) => {
    const host = String(req.headers["x-test-host"] ?? "");
    // The path only: a presigned PUT carries its signature in the query.
    const path = (req.url ?? "/").split("?")[0]!;
    received.push(`${req.method} ${host}${path}`);
    req.resume();
    req.on("end", async () => {
      if (req.method === "PUT") return res.writeHead(200).end();
      const answer = await respond(host, path);
      res.writeHead(answer.status, {
        ...answer.headers,
        ...(answer.type && { "content-type": answer.type }),
      });
      res.end(answer.body);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  stub.port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));
beforeEach(() => {
  vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
  received.length = 0;
  beforePage = undefined;
});

describe("website fetch", () => {
  it("refuses private, loopback and link-local sites before any request", async () => {
    for (const site of [
      "http://127.0.0.1/",
      `http://127.0.0.1:${stub.port}/`,
      "http://localhost/",
      "http://[::1]/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/",
      "http://[fe80::1]/",
      "http://internal.example/",
    ])
      expect(await fetchWebsiteBranding(new URL(site))).toBeNull();
    expect(received).toEqual([]);
  });

  it.each([
    "redirect.example",
    "metadata.example",
    "rebind.example",
    "port.example",
  ])("refuses a redirect from %s after the first hop", async (host) => {
    expect(await fetchWebsiteBranding(new URL(`https://${host}`))).toBeNull();
    expect(received).toEqual([`GET ${host}/`]);
  });

  it("reads the best icon and a safe theme color from a public page", async () => {
    const logo = await fetchWebsiteBranding(new URL("https://brand.example"));
    expect(logo).toMatchObject({ contentType: "image/png", color: "#2563EB" });
    expect(logo!.bytes.equals(png(192))).toBe(true);
    expect(received).toEqual([
      "GET brand.example/",
      "GET brand.example/icon.png",
    ]);
  });

  it("ranks icons, refuses grey or pale colors and checks image bytes", () => {
    const head = readHead(
      `<head><link rel="icon" href="/a.svg"><link rel="icon" href="/fav.ico">
       <link rel="icon" sizes="32x32" href="/small.png"><link rel="apple-touch-icon" href="/touch.png">
       <meta property="og:image" content="/social.jpg"></head>`,
      "https://acme.example/",
    );
    expect(head.candidates.map((one) => new URL(one.url).pathname)).toEqual([
      "/touch.png",
      "/apple-touch-icon.png",
      "/small.png",
      "/social.jpg",
    ]);
    expect(brandColor("#2563eb")).toBe("#2563EB");
    expect(brandColor("#555")).toBeNull();
    expect(brandColor("#FFE4E1")).toBeNull();

    const gif = Buffer.from("GIF89a\x40\x00\x20\x00", "latin1");
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBPVP8X", 8, "ascii");
    webp.writeUIntLE(63, 24, 3);
    webp.writeUIntLE(31, 27, 3);
    // SOI, an APP0 segment of 4 bytes, then a SOF0 frame header: height 32, width 64.
    const jpeg = Buffer.from(
      "ffd8ffe000040000ffc0001108002000400300000000",
      "hex",
    );
    for (const [bytes, type] of [
      [png(64).subarray(0, 24), "image/png"],
      [gif, "image/gif"],
      [webp, "image/webp"],
      [jpeg, "image/jpeg"],
    ] as const) {
      const size = imageSize(bytes, type);
      expect(size).toEqual(
        type === "image/png"
          ? { width: 64, height: 64 }
          : { width: 64, height: 32 },
      );
      // Bytes of another type, or cut short, are not that image.
      expect(
        imageSize(bytes, type === "image/png" ? "image/gif" : "image/png"),
      ).toBeNull();
      expect(imageSize(bytes.subarray(0, 9), type)).toBeNull();
    }
  });

  it("parses a hostile head in linear time", () => {
    const started = performance.now();
    readHead("<meta <link ".repeat(16_000), "https://acme.example/");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("keeps the trusted fetch module off the database and the request helpers", () => {
    const source = readFileSync(
      new URL("./website-fetch.ts", import.meta.url),
      "utf8",
    );
    expect(
      [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]),
    ).toEqual([
      "node:crypto",
      "../../import/destination-fetch",
      "../../import/guarded-fetch",
      "../../utils/sensitive-outbound",
      "../framework/files",
      // A static list of personal email providers; no database access.
      "../../database/quills/email/personal-email-domains",
    ]);
  });
});

describe.skipIf(!url)("website branding routes", () => {
  beforeAll(async () => {
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${stub.port}`);
    vi.stubEnv("S3_BUCKET", "quills-website");
    vi.stubEnv("S3_ACCESS_KEY_ID", "website");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "website-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
    pool = new Pool({ connectionString: url, max: 5 });
    env = await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopContract();
  });

  it("starts once from the caller's work email domain", async () => {
    expect((await call("GET", "")).body.branding).toMatchObject({
      domain: "example.test",
      status: "eligible",
    });
    const first = await call("POST", "/start");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      started: true,
      branding: { domain: "example.test", status: "offered", canUse: true },
    });
    expect(received).toContain("GET example.test/");
    const again = await call("POST", "/start");
    expect(again.body).toMatchObject({
      started: false,
      branding: { status: "offered" },
    });
    expect(await events("branding.auto_started")).toBe(1);
    expect((await call("POST", "/decline")).status).toBe(200);
  });

  it("keeps the lookup that another request recorded during start", async () => {
    await reset();
    const other = {
      version: 1,
      status: "failed",
      domain: "example.test",
      completedAt: new Date().toISOString(),
    };
    beforePage = async () => {
      await pool.query(
        "UPDATE quills.settings SET metadata=$2 WHERE workspace_id=$1",
        [env.a, JSON.stringify({ brandingLookup: other })],
      );
    };
    const res = await call("POST", "/start");
    expect(res.body).toMatchObject({
      started: false,
      branding: { status: "failed" },
    });
    expect(await state()).toEqual(other);
    const key = putKey();
    expect(await fileRows(key)).toBe(0);
    expect(await queued(key)).toBe(true);
  });

  it("offers, applies and undoes a website logo through the storage lifecycle", async () => {
    await reset();
    const found = await call("POST", "/lookup", { site: "brand.example" });
    expect(found.status).toBe(200);
    expect(found.body.branding).toMatchObject({
      domain: "brand.example",
      status: "offered",
      canUse: true,
      canUndo: false,
    });
    expect(found.body.branding.logoUrl).toContain("X-Amz-Signature=");
    const key = await offerKey();
    expect(key).toMatch(
      new RegExp(`^workspace/${env.a}/quills/logo/[a-z0-9]+\\.png$`),
    );
    // Written once, verified under the shared lease, and held by a files row.
    expect(putKey()).toBe(key);
    expect(await leased(key)).toBe(true);
    expect(await fileRows(key)).toBe(1);
    expect(await queued(key)).toBe(false);
    expect((await call("GET", "")).body.branding.status).toBe("offered");

    const applied = await call("POST", "/accept");
    expect(applied.status).toBe(200);
    expect(applied.body.branding).toMatchObject({
      status: "applied",
      colorApplied: true,
      canUndo: true,
    });
    const theme = JSON.stringify({
      light: { primary: "#2563EB" },
      dark: { primary: "#2563EB" },
    });
    expect(await row()).toMatchObject({
      logo_key: key,
      branding_config: theme,
    });
    expect(await fileRows(key)).toBe(0);
    // The files row let the key go, but logo_key holds it: the worker keeps the object.
    await expireLease(key);
    await drain(key);
    expect(deleteS3Object).not.toHaveBeenCalledWith(key);
    expect(await events("branding.offer_accepted")).toBe(1);

    const undone = await call("POST", "/undo");
    expect(undone.status).toBe(200);
    expect(undone.body.branding).toMatchObject({ status: "undone" });
    expect(await row()).toMatchObject({
      logo_key: null,
      branding_config: null,
    });
    expect(await queued(key)).toBe(true);
    await drain(key);
    expect(deleteS3Object).toHaveBeenCalledWith(key);
    expect((await call("POST", "/undo")).status).toBe(409);
    expect(await events("branding.auto_undone")).toBe(1);
  });

  it("keeps an administrator's theme and restores only the logo", async () => {
    await reset();
    const custom = JSON.stringify({ light: { primary: "#111111" } });
    await pool.query(
      "UPDATE quills.settings SET branding_config=$2 WHERE workspace_id=$1",
      [env.a, custom],
    );
    await call("POST", "/lookup", { site: "brand.example" });
    const applied = await call("POST", "/accept");
    expect(applied.body.branding).toMatchObject({ colorApplied: false });
    expect((await row()).branding_config).toBe(custom);
    expect((await call("POST", "/undo")).status).toBe(200);
    expect(await row()).toMatchObject({
      logo_key: null,
      branding_config: custom,
    });

    // Custom CSS also keeps the theme.
    await reset();
    await pool.query(
      "UPDATE quills.settings SET custom_css='.portal { color: red; }' WHERE workspace_id=$1",
      [env.a],
    );
    await call("POST", "/lookup", { site: "brand.example" });
    expect((await call("POST", "/accept")).body.branding).toMatchObject({
      colorApplied: false,
    });
    expect((await row()).branding_config).toBeNull();
  });

  it("keeps an undo off a theme that changed after accept", async () => {
    await reset();
    await call("POST", "/lookup", { site: "brand.example" });
    expect((await call("POST", "/accept")).status).toBe(200);
    const edited = JSON.stringify({ light: { primary: "#000000" } });
    await pool.query(
      "UPDATE quills.settings SET branding_config=$2 WHERE workspace_id=$1",
      [env.a, edited],
    );
    const before = await row();
    expect((await call("POST", "/undo")).status).toBe(409);
    expect(await row()).toEqual(before);
    expect((await call("GET", "")).body.branding).toBeNull();
  });

  it("keeps an accept that commits while a later lookup fetches", async () => {
    await reset();
    await call("POST", "/lookup", { site: "brand.example" });
    const offered = await offerKey();
    beforePage = async () => {
      beforePage = undefined;
      expect((await call("POST", "/accept")).status).toBe(200);
    };
    received.length = 0;
    const res = await call("POST", "/lookup", { site: "brand.example" });
    expect(res.body.branding).toMatchObject({ status: "applied" });
    expect(await state()).toMatchObject({
      status: "applied",
      receipt: { logoKey: { before: null, after: offered } },
    });
    const late = putKey();
    expect(await fileRows(late)).toBe(0);
    expect(await queued(late)).toBe(true);
    expect((await call("POST", "/undo")).status).toBe(200);
  });

  it("drops a replaced and a declined offer", async () => {
    await reset();
    await call("POST", "/lookup", { site: "brand.example" });
    const first = await offerKey();
    await call("POST", "/lookup", { site: "brand.example" });
    const second = await offerKey();
    expect(second).not.toBe(first);
    expect(await fileRows(first)).toBe(0);
    expect(await queued(first)).toBe(true);
    // The live verification lease protects the object; after it ends, the worker deletes it.
    await retryStorageCleanup();
    expect(deleteS3Object).not.toHaveBeenCalledWith(first);
    await expireLease(first);
    await drain(first);
    expect(deleteS3Object).toHaveBeenCalledWith(first);

    const before = await events("branding.offer_declined");
    const declined = await call("POST", "/decline");
    expect(declined.body.branding).toMatchObject({ status: "declined" });
    expect(await fileRows(second)).toBe(0);
    expect(await queued(second)).toBe(true);
    expect((await call("POST", "/accept")).status).toBe(409);
    expect((await call("POST", "/decline")).status).toBe(409);
    expect(await events("branding.offer_declined")).toBe(before + 1);
  });

  it("refuses an offer whose files row is gone", async () => {
    await reset();
    await call("POST", "/lookup", { site: "brand.example" });
    const key = await offerKey();
    await pool.query(
      "DELETE FROM quills.files WHERE workspace_id=$1 AND storage_key=$2",
      [env.a, key],
    );
    const before = await row();
    expect((await call("POST", "/accept")).status).toBe(409);
    expect(await row()).toEqual(before);
  });

  it("records a refused redirect as failed with nothing stored", async () => {
    await reset();
    const res = await call("POST", "/lookup", { site: "redirect.example" });
    expect(res.status).toBe(200);
    expect(res.body.branding).toMatchObject({ status: "failed" });
    expect(received).toEqual(["GET redirect.example/"]);
    for (const site of [
      "http://127.0.0.1:8080",
      "ftp://brand.example",
      "a b",
      `${"a".repeat(60)}.`.repeat(5) + "com",
    ])
      expect((await call("POST", "/lookup", { site })).status).toBe(400);
  });

  it("queues a logo that storage did not verify", async () => {
    await reset();
    vi.mocked(verifyTaskAssetUpload).mockRejectedValueOnce(
      new Error("storage is down"),
    );
    const res = await call("POST", "/lookup", { site: "brand.example" });
    expect(res.body.branding).toMatchObject({ status: "failed" });
    const key = putKey();
    expect(await fileRows(key)).toBe(0);
    expect(await leased(key)).toBe(false);
    expect(await queued(key)).toBe(true);
  });

  it("commits no reference after the verification deadline passes", async () => {
    await reset();
    const files =
      await vi.importActual<typeof import("../framework/files")>(
        "../framework/files",
      );
    vi.mocked(verifyUpload).mockImplementationOnce((async (
      ...args: Parameters<typeof files.verifyUpload>
    ) => ({
      ...(await files.verifyUpload(...args)),
      deadline: Date.now() - 1,
    })) as never);
    const before = await row();
    const res = await call("POST", "/lookup", { site: "brand.example" });
    expect(res.status).toBe(503);
    expect(await fileRows(putKey())).toBe(0);
    expect(await row()).toEqual(before);
  });

  it("rolls back the offer and the queued key of a failed lookup", async () => {
    await reset();
    await call("POST", "/lookup", { site: "brand.example" });
    const previous = await offerKey();
    const d = [...registry.keys()].find(
      (r) => r.operationId === "lookupQuillsWebsiteBranding",
    )!;
    const failing = contractApp(
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
    const before = await row();
    received.length = 0;
    const res = await send(failing, "POST", "/lookup", {
      site: "brand.example",
    });
    expect(res.status).toBe(500);
    expect(await row()).toEqual(before);
    expect(await fileRows(previous)).toBe(1);
    expect(await queued(previous)).toBe(false);
    expect(await fileRows(putKey())).toBe(0);
  });

  it("refuses a lookup while the workspace has a logo, and a second lookup at once", async () => {
    await reset();
    let second: Awaited<ReturnType<typeof call>> | undefined;
    beforePage = async () => {
      beforePage = undefined;
      second = await call("POST", "/lookup", { site: "brand.example" });
    };
    expect(
      (await call("POST", "/lookup", { site: "brand.example" })).status,
    ).toBe(200);
    expect(second).toMatchObject({ status: 409 });
    await pool.query(
      "UPDATE quills.settings SET logo_key=$2 WHERE workspace_id=$1",
      [env.a, `workspace/${env.a}/quills/logo/manual.png`],
    );
    expect(
      (await call("POST", "/lookup", { site: "brand.example" })).status,
    ).toBe(409);
  });

  it("queues the logo when the workspace gets a logo during the fetch", async () => {
    await reset();
    const manual = `workspace/${env.a}/quills/logo/manual.png`;
    beforePage = async () => {
      await pool.query(
        "UPDATE quills.settings SET logo_key=$2 WHERE workspace_id=$1",
        [env.a, manual],
      );
    };
    const res = await call("POST", "/lookup", { site: "brand.example" });
    expect(res.body.branding).toMatchObject({ status: "skipped" });
    const key = putKey();
    expect(await fileRows(key)).toBe(0);
    expect(await queued(key)).toBe(true);
    expect((await row()).logo_key).toBe(manual);
  });
});
