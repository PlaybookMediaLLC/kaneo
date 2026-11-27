import { deflateRawSync, inflateRawSync } from "node:zlib";

// Zero-dependency standard PKZIP (DEFLATE) reader/writer for workspace export bundles (#327).
// Trusted framework module: pure memory transforms, zero database or network I/O.

export const MAX_ZIP_EXTRACTED_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 25_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Rejects Zip Slip traversal or absolute paths. */
export function assertSafeZipEntryName(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error(`Unsafe zip entry path: ${name}`);
  }
  return normalized;
}

export type ZipEntryInput = {
  name: string;
  data: Uint8Array | string;
};

/** Builds a standard PKZIP archive using DEFLATE (method 8). */
export function buildZipArchive(entries: readonly ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const safeName = assertSafeZipEntryName(entry.name);
    const nameBytes = Buffer.from(safeName, "utf8");
    const raw =
      typeof entry.data === "string"
        ? Buffer.from(entry.data, "utf8")
        : Buffer.from(entry.data);
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // compression method: DEFLATE
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBytes, compressed);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // DEFLATE
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  if (entries.length > 0xffff) {
    throw new Error("Zip archive exceeds 65,535 PKZIP entry limit");
  }
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** Extracts a PKZIP archive (STORE=0 or DEFLATE=8) with Zip Slip & decompression bomb guards. */
export function extractZipArchive(
  input: Uint8Array,
  maxBytes = MAX_ZIP_EXTRACTED_BYTES,
): Map<string, Buffer> {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  // Locate End of Central Directory record
  let eocdOffset = -1;
  const searchStart = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (
      buf.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buf.readUInt16LE(i + 20) === buf.length
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid zip archive: missing EOCD");

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  if (entryCount === 0xffff) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error("Zip archive exceeds maximum entry count");
  }
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset === 0xffffffff || cdOffset > eocdOffset) {
    throw new Error("Invalid zip central directory offset");
  }

  const files = new Map<string, Buffer>();
  let actualExtracted = 0;
  let pos = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > eocdOffset || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("Invalid zip central directory header");
    }
    const method = buf.readUInt16LE(pos + 10);
    const expectedCrc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);

    if (
      compSize === 0xffffffff ||
      uncompSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 entries are not supported");
    }
    if (pos + 46 + nameLen + extraLen + commentLen > eocdOffset) {
      throw new Error("Truncated zip central directory entry");
    }

    const rawName = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    const safeName = assertSafeZipEntryName(rawName);
    if (files.has(safeName)) {
      throw new Error(`Duplicate zip entry: ${safeName}`);
    }
    pos += 46 + nameLen + extraLen + commentLen;

    const remainingBudget = maxBytes - actualExtracted;
    if (uncompSize > remainingBudget) {
      throw new Error("Zip archive exceeds maximum extracted size budget");
    }

    if (
      localOffset + 30 > buf.length ||
      buf.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      throw new Error(`Invalid local file header for ${safeName}`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) {
      throw new Error(`Truncated zip entry payload: ${safeName}`);
    }
    const compressed = buf.subarray(dataStart, dataStart + compSize);

    let extracted: Buffer;
    if (method === 0) {
      if (compSize !== uncompSize || compSize > remainingBudget) {
        throw new Error(`Invalid stored entry size for ${safeName}`);
      }
      extracted = Buffer.from(compressed);
    } else if (method === 8) {
      extracted = inflateRawSync(compressed, {
        maxOutputLength: remainingBudget,
      });
    } else {
      throw new Error(`Unsupported zip compression method: ${method}`);
    }

    if (extracted.length !== uncompSize) {
      throw new Error(`Decompressed size mismatch for zip entry: ${safeName}`);
    }
    actualExtracted += extracted.length;
    if (actualExtracted > maxBytes) {
      throw new Error("Zip archive exceeds maximum extracted size budget");
    }
    if (crc32(extracted) !== expectedCrc) {
      throw new Error(`CRC32 mismatch for zip entry: ${safeName}`);
    }
    files.set(safeName, extracted);
  }

  return files;
}
