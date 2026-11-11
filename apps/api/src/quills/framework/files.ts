import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, like, lt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Database } from "../../database/quills/client";
import { jobLeaseTable } from "../../database/schema";
import {
  lockStorageObjects,
  withStorageObject,
} from "../../storage/cleanup-queue";
import { describeStorageError } from "../../storage/describe-storage-error";
import {
  applyKeyPrefix,
  assertStorageConfigured,
  getFileExtension,
  InvalidUploadedAssetError,
  isImageContentType,
  isStorageConfigured,
  resolveS3Credentials,
  sanitizePathSegment,
  validateTaskAssetUploadInput,
  verifyTaskAssetUpload,
} from "../../storage/s3";
import { z } from "../../openapi";

// Managed Quills uploads on Kaneo's storage: server-derived keys, presigned PUT, then a
// verification lease that protects the object until the scoped transaction commits its reference.

export const contentPurposes = [
  "file",
  "post_image",
  "changelog_image",
] as const;
export const settingsPurposes = [
  "logo",
  "favicon",
  "header_logo",
  "assistant_avatar",
  "widget_hero",
] as const;
/** Purposes registered in `quills.files`. Settings keys register in their own column. */
export const filePurposes = [...contentPurposes, "assistant_avatar"] as const;
/**
 * Portal and widget uploads. Their keys have one more path segment, the customer's ID, so a
 * customer can verify only its own uploads.
 */
export const customerPurposes = [
  "customer_file",
  "customer_image",
  "customer_avatar",
] as const;
export type Purpose =
  | (typeof contentPurposes)[number]
  | (typeof settingsPurposes)[number]
  | (typeof customerPurposes)[number];
const isCustomerPurpose = (purpose: Purpose | "export") =>
  (customerPurposes as readonly string[]).includes(purpose);
/** What a customer may attach besides images: no markup, scripts or executables. */
const customerFileTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
]);

const contentType = z
  .string()
  .trim()
  .toLowerCase()
  .max(100)
  .regex(
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/,
    "Invalid content type",
  );
// The configured S3_MAX_IMAGE_UPLOAD_BYTES limit applies at run time.
const size = z
  .number()
  .int()
  .positive()
  .max(1024 ** 3);

export const uploadRequest = <P extends readonly [Purpose, ...Purpose[]]>(
  purposes: P,
) =>
  z.object({
    purpose: z.enum(purposes),
    filename: z.string().trim().min(1).max(255),
    contentType,
    size,
  });
export const uploadResponse = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  headers: z.object({ "Content-Type": z.string() }),
  expiresAt: z.string(),
});
/** The object a client uploaded with a URL from an upload route. */
export const uploadedObject = z.object({
  key: z.string().min(1).max(1024),
  contentType,
  size,
});

export const isQuillsStorageConfigured = () => isStorageConfigured();

type StorageConfig = ReturnType<typeof assertStorageConfigured>;
function storage() {
  try {
    return assertStorageConfigured();
  } catch {
    throw new HTTPException(503, { message: "File storage is not configured" });
  }
}

// ponytail: storage/s3.ts keeps its client private and signs only task and project keys, so this
// repeats its client options and cache. Use an upstream export that signs any key when one exists.
let cached: { key: string; client: S3Client } | undefined;
function client(config: StorageConfig) {
  const key = JSON.stringify([
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.forcePathStyle,
  ]);
  // One client per configuration, so credentials from the default provider chain stay cached.
  if (cached?.key !== key)
    cached = {
      key,
      client: new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        requestChecksumCalculation: "WHEN_REQUIRED",
        credentials: resolveS3Credentials(
          config.accessKeyId,
          config.secretAccessKey,
        ),
      }),
    };
  return cached.client;
}

/** A customer purpose takes the customer's ID as `owner`; no other purpose takes one. */
function namespace(
  config: StorageConfig,
  workspaceId: string,
  purpose: Purpose | "export",
  owner?: string,
) {
  if (isCustomerPurpose(purpose) !== Boolean(owner))
    throw new Error(`Upload owner mismatch for ${purpose}`);
  const segments = [
    "workspace",
    sanitizePathSegment(workspaceId),
    "quills",
    purpose,
    ...(owner ? [sanitizePathSegment(owner)] : []),
  ];
  return `${applyKeyPrefix(config.keyPrefix, segments.join("/"))}/`;
}

function checkUpload(purpose: Purpose, type: string, bytes: number) {
  if (
    purpose === "customer_file"
      ? !isImageContentType(type) && !customerFileTypes.has(type)
      : purpose !== "file" && !isImageContentType(type)
  )
    throw new HTTPException(400, {
      message:
        purpose === "customer_file"
          ? "Upload an image, a PDF or a text file."
          : "Upload a supported image.",
    });
  try {
    validateTaskAssetUploadInput(type, bytes);
  } catch (error) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
}

/**
 * A presigned PUT for a new key in this workspace's namespace for `purpose`. `customer`: the
 * caller's customer ID, required for customer purposes.
 */
export async function createUpload(
  workspaceId: string,
  input: z.output<ReturnType<typeof uploadRequest>>,
  customer?: string,
): Promise<z.input<typeof uploadResponse>> {
  checkUpload(input.purpose, input.contentType, input.size);
  const config = storage();
  const extension = getFileExtension(input.filename);
  const key = `${namespace(config, workspaceId, input.purpose, customer)}${createId()}${extension ? `.${extension}` : ""}`;
  const uploadUrl = await getSignedUrl(
    client(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.size,
    }),
    {
      expiresIn: config.presignTtlSeconds,
      signableHeaders: new Set(["content-length", "content-type"]),
    },
  );
  return {
    key,
    uploadUrl,
    // The browser sets Content-Length from the body; it is signed but must not be set by script.
    headers: { "Content-Type": input.contentType },
    expiresAt: new Date(
      Date.now() + config.presignTtlSeconds * 1000,
    ).toISOString(),
  };
}

/** RFC 6266 disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
function disposition(type: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** A short-lived GET for a registered file. Only images open inline. */
export async function createDownload(file: {
  storageKey: string;
  name: string;
  contentType: string;
}) {
  const config = storage();
  return {
    downloadUrl: await getSignedUrl(
      client(config),
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: file.storageKey,
        ResponseContentType: file.contentType,
        ResponseContentDisposition: disposition(
          isImageContentType(file.contentType) ? "inline" : "attachment",
          file.name,
        ),
      }),
      { expiresIn: config.presignTtlSeconds },
    ),
    downloadExpiresAt: new Date(Date.now() + config.presignTtlSeconds * 1000),
  };
}

/**
 * A short-lived inline GET for a verified image key that has no file row (a customer avatar). The
 * object keeps the image type that its verified upload stored. Null when storage is not configured.
 */
export async function imageUrl(key: string) {
  if (!isStorageConfigured()) return null;
  const config = storage();
  return getSignedUrl(
    client(config),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: config.presignTtlSeconds },
  );
}

/**
 * A new key for a file that the server writes, in this workspace's export namespace. Store the key
 * on its row before `putObject`, so the storage trigger queues cleanup when the row lets it go.
 */
export const exportKey = (workspaceId: string, extension: string) =>
  `${namespace(storage(), workspaceId, "export")}${createId()}.${extension}`;

/** Writes a file that the server generated, with a time limit. */
export async function putObject(key: string, body: string, type: string) {
  const config = storage();
  await client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: type,
    }),
    { abortSignal: AbortSignal.timeout(120_000) },
  );
}

/** Reads a stored object with a time limit. More than `maxBytes` throws. */
export async function readObject(key: string, maxBytes: number) {
  const config = storage();
  const object = await client(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(60_000) },
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Stored object exceeds the limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export type VerifiedUpload = {
  key: string;
  contentType: string;
  size: number;
  /** The reference must commit before this time, or the lease no longer protects the object. */
  deadline: number;
};

// The lease name and duration of withVerifiedStorageObject in storage/cleanup-queue.ts; the cleanup
// worker skips an object while this lease is live. lifecycle.test.ts runs the real worker against it.
const LEASE_MS = 60_000;
const leaseName = (key: string) => `storage-verification:${key}`;
// Room for clock skew between API instances that read the same lease.
const SKEW_MS = 10_000;
const expired = () =>
  new HTTPException(503, {
    message: "Upload verification expired; retry the upload.",
  });

/**
 * Checks that `input.key` is an upload of this workspace for one of `purposes`, takes the shared
 * verification lease and verifies the stored object. Call from a route's `load`, never inside the
 * transaction: verification holds no pooled connection. The handler then calls `holdVerifiedUpload`.
 *
 * ponytail: a verified lease is not released after commit, because define-route has no post-commit
 * hook for mutations. It expires after 60 s (a retry of the same key in that time gets 503), and a
 * later verification deletes it.
 */
export async function verifyUpload(
  workspaceId: string,
  purposes: readonly Purpose[],
  input: z.output<typeof uploadedObject>,
  options?: { customer?: string },
): Promise<VerifiedUpload>;
export async function verifyUpload(
  workspaceId: string,
  purposes: readonly Purpose[],
  input: z.output<typeof uploadedObject>,
  options: { digest: true; customer?: string },
): Promise<VerifiedUpload & { sha256: string }>;
/** `customer`: the caller's customer ID, required for customer purposes. */
export async function verifyUpload(
  workspaceId: string,
  purposes: readonly Purpose[],
  input: z.output<typeof uploadedObject>,
  options: { digest?: boolean; customer?: string } = {},
): Promise<VerifiedUpload & { sha256?: string }> {
  const config = storage();
  const prefix = (p: Purpose) =>
    namespace(config, workspaceId, p, options.customer);
  const purpose = purposes.find((p) => input.key.startsWith(prefix(p)));
  const suffix = purpose ? input.key.slice(prefix(purpose).length) : "";
  // Another workspace's or customer's key, another purpose's key or a path suffix is not this upload.
  if (!purpose || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(suffix))
    throw new HTTPException(404, { message: "Upload not found" });
  checkUpload(purpose, input.contentType, input.size);

  const owner = randomUUID();
  const expiresAt = new Date(Date.now() + LEASE_MS);
  const deadline = expiresAt.getTime() - SKEW_MS;
  await withStorageObject(input.key, async (tx) => {
    const current = await tx.query.jobLeaseTable.findFirst({
      where: eq(jobLeaseTable.name, leaseName(input.key)),
    });
    if (current && current.expiresAt > new Date())
      throw new HTTPException(503, {
        message: "Upload verification is already in progress.",
      });
    await tx
      .insert(jobLeaseTable)
      .values({ name: leaseName(input.key), owner, expiresAt })
      .onConflictDoUpdate({
        target: jobLeaseTable.name,
        set: { owner, expiresAt },
      });
    // Committed uploads keep their lease row; remove Quills rows that expired an hour ago.
    await tx.delete(jobLeaseTable).where(
      inArray(
        jobLeaseTable.name,
        tx
          .select({ name: jobLeaseTable.name })
          .from(jobLeaseTable)
          .where(
            and(
              like(jobLeaseTable.name, "storage-verification:%/quills/%"),
              lt(jobLeaseTable.expiresAt, new Date(Date.now() - 3_600_000)),
            ),
          )
          .limit(100),
      ),
    );
  });
  try {
    const stored = await verifyTaskAssetUpload(input.key, input).catch(
      (error) => {
        throw new HTTPException(
          error instanceof InvalidUploadedAssetError ? 400 : 503,
          {
            message:
              error instanceof InvalidUploadedAssetError
                ? error.message
                : "Unable to verify uploaded object.",
          },
        );
      },
    );
    const sha256 = options.digest
      ? await digest(config, input.key, deadline)
      : undefined;
    // A lease that was taken over or removed while the object was read protects nothing.
    await withStorageObject(input.key, async (tx) => {
      const lease = await tx.query.jobLeaseTable.findFirst({
        where: eq(jobLeaseTable.name, leaseName(input.key)),
      });
      if (lease?.owner !== owner || Date.now() >= deadline) throw expired();
    });
    return {
      key: input.key,
      contentType: stored.contentType.toLowerCase(),
      size: stored.size,
      sha256,
      deadline,
    };
  } catch (error) {
    // A failed verification commits nothing, so the lease can go now.
    await withStorageObject(input.key, (tx) =>
      tx
        .delete(jobLeaseTable)
        .where(
          and(
            eq(jobLeaseTable.name, leaseName(input.key)),
            eq(jobLeaseTable.owner, owner),
          ),
        ),
    );
    throw error;
  }
}

/** Reads the object once, on its own client and with a time limit, so a stalled read ends. */
async function digest(config: StorageConfig, key: string, deadline: number) {
  const hash = createHash("sha256");
  try {
    const object = await client(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) },
    );
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>)
      hash.update(chunk);
  } catch (error) {
    console.error(
      "Unable to read uploaded object:",
      describeStorageError(error),
    );
    throw new HTTPException(503, {
      message: "Unable to verify uploaded object.",
    });
  }
  return hash.digest("hex");
}

/**
 * Call in the handler before the reference write. The object lock serializes this transaction with
 * the cleanup worker until commit, so a lease that is live now protects the object through commit.
 */
export async function holdVerifiedUpload(db: Database, upload: VerifiedUpload) {
  await lockStorageObjects(db, [upload.key]);
  if (Date.now() >= upload.deadline) throw expired();
}
