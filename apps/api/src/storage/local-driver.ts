import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

export type StorageDriver = "s3" | "local";

/**
 * Selects the active object storage driver (#303):
 * - Explicit `STORAGE_DRIVER=local` always uses local filesystem storage.
 * - Explicit `STORAGE_DRIVER=s3` always uses S3/R2/MinIO.
 * - When unset: uses `s3` if `S3_BUCKET` or `S3_ENDPOINT` is set, otherwise `local` when
 *   `LOCAL_STORAGE_DIR` is configured so single-host self-hosting works with zero S3/MinIO!
 */
export function getStorageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "s3") return "s3";
  const hasS3 = Boolean(
    process.env.S3_BUCKET?.trim() || process.env.S3_ENDPOINT?.trim(),
  );
  if (hasS3) return "s3";
  if (process.env.LOCAL_STORAGE_DIR?.trim()) return "local";
  return "s3";
}

export function getLocalStorageDir(): string {
  return path.resolve(process.env.LOCAL_STORAGE_DIR?.trim() || "/data/uploads");
}

/**
 * Resolves an object key inside the local storage directory, strictly rejecting path traversal,
 * null bytes, absolute paths, or escapes outside the jail root.
 */
export function resolveLocalStoragePath(
  key: string,
  rootDir = getLocalStorageDir(),
): string {
  if (
    !key ||
    key.includes("\0") ||
    key.startsWith("/") ||
    key.startsWith("\\")
  ) {
    throw new HTTPException(400, { message: "Invalid storage key" });
  }
  const normalizedSegments = key.split(/[\\/]+/).filter(Boolean);
  if (
    normalizedSegments.length === 0 ||
    normalizedSegments.some((seg) => seg === "." || seg === "..")
  ) {
    throw new HTTPException(400, { message: "Invalid storage key" });
  }
  const root = path.resolve(rootDir);
  const full = path.resolve(root, ...normalizedSegments);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new HTTPException(400, { message: "Storage key escapes jail root" });
  }
  return full;
}

function metaPath(filePath: string) {
  return `${filePath}.obj-meta.json`;
}

export async function putLocalObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  rootDir = getLocalStorageDir(),
): Promise<{ size: number; contentType: string }> {
  const target = resolveLocalStoragePath(key, rootDir);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  const bytes =
    typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, target);
  await writeFile(
    metaPath(target),
    JSON.stringify({
      contentType,
      size: bytes.byteLength,
      updatedAt: new Date().toISOString(),
    }),
    "utf8",
  );
  return { size: bytes.byteLength, contentType };
}

export async function headLocalObject(
  key: string,
  rootDir = getLocalStorageDir(),
): Promise<{ size: number; contentType: string; lastModified: Date } | null> {
  const target = resolveLocalStoragePath(key, rootDir);
  try {
    const info = await stat(target);
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await readFile(metaPath(target), "utf8")) as {
        contentType?: string;
      };
      if (meta.contentType) contentType = meta.contentType;
    } catch {
      // Meta sidecar is optional.
    }
    return {
      size: info.size,
      contentType,
      lastModified: info.mtime,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function getLocalObject(
  key: string,
  rootDir = getLocalStorageDir(),
): Promise<{
  body: Buffer;
  size: number;
  contentType: string;
  lastModified: Date;
} | null> {
  const head = await headLocalObject(key, rootDir);
  if (!head) return null;
  const target = resolveLocalStoragePath(key, rootDir);
  const body = await readFile(target);
  return { ...head, body };
}

export async function deleteLocalObject(
  key: string,
  rootDir = getLocalStorageDir(),
): Promise<void> {
  const target = resolveLocalStoragePath(key, rootDir);
  await unlink(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
  await unlink(metaPath(target)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

export async function probeLocalStorage(
  rootDir = getLocalStorageDir(),
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  const probeFile = path.join(rootDir, `.storage-probe-${randomUUID()}.tmp`);
  await writeFile(probeFile, "ok", "utf8");
  await unlink(probeFile);
}

type LocalTokenPayload = {
  op: "upload" | "download";
  key: string;
  contentType?: string;
  maxBytes?: number;
  disposition?: string;
  exp: number;
};

function signingSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "dev-local-storage-fallback-secret"
  );
}

export function signLocalStorageToken(
  payload: Omit<LocalTokenPayload, "exp">,
  ttlSeconds = 300,
): string {
  const full: LocalTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(full), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", signingSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyLocalStorageToken(token: string): LocalTokenPayload {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) {
    throw new HTTPException(403, { message: "Invalid storage token" });
  }
  const expected = createHmac("sha256", signingSecret())
    .update(encoded)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new HTTPException(403, {
      message: "Invalid storage token signature",
    });
  }
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as LocalTokenPayload;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new HTTPException(403, { message: "Storage token expired" });
  }
  return payload;
}

export function buildLocalSignedUrl(
  op: "upload" | "download",
  token: string,
): string {
  const base = (
    process.env.KANEO_API_URL ||
    process.env.KANEO_CLIENT_URL ||
    "http://localhost:1337"
  ).replace(/\/$/, "");
  const apiBase = base.endsWith("/api") ? base : `${base}/api`;
  return op === "upload"
    ? `${apiBase}/storage/local/upload/${token}`
    : `${apiBase}/storage/local/object/${token}`;
}

/**
 * Signed-token HTTP endpoints for zero-S3 local filesystem uploads and downloads (#303).
 * Tokens are short-lived and HMAC-SHA256 signed with AUTH_SECRET.
 */
export const localStorageRoutes = new Hono()
  .put("/upload/:token", async (c) => {
    const payload = verifyLocalStorageToken(c.req.param("token"));
    if (payload.op !== "upload") {
      throw new HTTPException(403, { message: "Wrong token operation" });
    }
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (payload.maxBytes && raw.byteLength > payload.maxBytes) {
      throw new HTTPException(413, { message: "Uploaded file exceeds limit" });
    }
    const ct =
      payload.contentType ||
      c.req.header("content-type") ||
      "application/octet-stream";
    const saved = await putLocalObject(payload.key, raw, ct);
    return c.json({ ok: true, key: payload.key, size: saved.size }, 200);
  })
  .get("/object/:token", async (c) => {
    const payload = verifyLocalStorageToken(c.req.param("token"));
    if (payload.op !== "download") {
      throw new HTTPException(403, { message: "Wrong token operation" });
    }
    const obj = await getLocalObject(payload.key);
    if (!obj) {
      throw new HTTPException(404, { message: "Object not found" });
    }
    return new Response(new Uint8Array(obj.body), {
      status: 200,
      headers: {
        "Content-Type": payload.contentType || obj.contentType,
        "Content-Length": String(obj.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
        ...(payload.disposition
          ? { "Content-Disposition": payload.disposition }
          : {}),
      },
    });
  });
