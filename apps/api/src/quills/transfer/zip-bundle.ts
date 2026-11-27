import type { Database, QuillsActor } from "../../database/quills/client";
import {
  buildZipArchive,
  extractZipArchive,
  type ZipEntryInput,
} from "../framework/archive-io";
import {
  archiveSchema,
  exportWorkspaceArchive,
  OMITTED_TABLES,
  type WorkspaceArchive,
} from "./archive";
import {
  importWorkspaceArchive,
  prepareArchive,
  type CanonicalMember,
} from "./import-archive";

export type WorkspaceZipManifest = {
  format: "kaneo-workspace-zip";
  version: 1;
  origin: "kaneo" | "quackback";
  workspaceId: string;
  exportedAt: string;
  since: string | null;
  tableCounts: Record<string, number>;
  markdownArticleCount: number;
  fileCount: number;
  storageKeys: string[];
  omittedTables: string[];
};

function filterRowSince(
  row: Record<string, unknown>,
  sinceMs: number,
): boolean {
  const ts =
    typeof row.updated_at === "string"
      ? Date.parse(row.updated_at)
      : typeof row.created_at === "string"
        ? Date.parse(row.created_at)
        : Number.NaN;
  if (!Number.isFinite(ts)) return true;
  return ts >= sinceMs;
}

function renderArticleMarkdown(row: Record<string, unknown>): string {
  const title = String(row.title ?? "Untitled").replace(/\r?\n/g, " ");
  const slug = String(row.slug ?? row.id ?? "article");
  const updatedAt = row.updated_at ? String(row.updated_at) : "";
  const publishedAt = row.published_at ? String(row.published_at) : "";
  const content = String(row.content ?? "");
  return [
    "---",
    `id: ${String(row.id ?? "")}`,
    `slug: ${slug}`,
    `title: ${JSON.stringify(title)}`,
    ...(publishedAt ? [`published_at: ${publishedAt}`] : []),
    ...(updatedAt ? [`updated_at: ${updatedAt}`] : []),
    "---",
    "",
    content,
    "",
  ].join("\n");
}

/**
 * Exports a full (or incremental `since`) workspace .zip bundle (#327):
 * - `manifest.json`: format, counts, timestamps, storageKeys, omittedTables
 * - `data/<table>.ndjson`: newline-delimited JSON per portable table
 * - `articles/<slug>.md`: human-readable Markdown with frontmatter for live KB articles
 * - `files/<storageKey>`: binary attachment bytes when `readFileBytes` is provided
 */
export async function exportWorkspaceZipBundle(
  db: Database,
  workspaceId: string,
  options: {
    since?: Date | null;
    readFileBytes?: (storageKey: string) => Promise<Uint8Array | null>;
  } = {},
): Promise<{ zip: Buffer; manifest: WorkspaceZipManifest }> {
  const archive = await exportWorkspaceArchive(db, workspaceId);
  const sinceMs = options.since ? options.since.getTime() : null;

  const entries: ZipEntryInput[] = [];
  const tableCounts: Record<string, number> = {};

  for (const [tableName, allRows] of Object.entries(archive.tables)) {
    const rows =
      sinceMs !== null
        ? allRows.filter((row) => filterRowSince(row, sinceMs))
        : allRows;
    tableCounts[tableName] = rows.length;
    if (!rows.length) continue;
    const ndjson = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
    entries.push({ name: `data/${tableName}.ndjson`, data: ndjson });
  }

  // Human-readable Markdown export for live KB articles
  const kbRows = (archive.tables.kb_articles ?? []).filter(
    (row) => !row.deleted_at,
  );
  let markdownArticleCount = 0;
  const usedSlugs = new Set<string>();
  for (const row of kbRows) {
    if (sinceMs !== null && !filterRowSince(row, sinceMs)) continue;
    const rawSlug =
      String(row.slug ?? row.id ?? `article-${markdownArticleCount}`)
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || `article-${markdownArticleCount}`;
    let slug = rawSlug;
    let suffix = 1;
    while (usedSlugs.has(slug)) {
      slug = `${rawSlug}-${suffix++}`;
    }
    usedSlugs.add(slug);
    entries.push({
      name: `articles/${slug}.md`,
      data: renderArticleMarkdown(row),
    });
    markdownArticleCount += 1;
  }

  // Binary attachments when a reader is supplied
  let fileCount = 0;
  if (options.readFileBytes) {
    for (const key of archive.storageKeys) {
      const bytes = await options.readFileBytes(key);
      if (!bytes) continue;
      const safeKey = key.replace(/^\/+/, "");
      entries.push({ name: `files/${safeKey}`, data: bytes });
      fileCount += 1;
    }
  }

  const manifest: WorkspaceZipManifest = {
    format: "kaneo-workspace-zip",
    version: 1,
    origin: archive.origin,
    workspaceId,
    exportedAt: archive.createdAt,
    since: options.since ? options.since.toISOString() : null,
    tableCounts,
    markdownArticleCount,
    fileCount,
    storageKeys: archive.storageKeys,
    omittedTables: [...OMITTED_TABLES],
  };

  entries.unshift({
    name: "manifest.json",
    data: JSON.stringify(manifest, null, 2),
  });

  return {
    zip: buildZipArchive(entries),
    manifest,
  };
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parses a workspace .zip bundle back into a validated WorkspaceArchive + manifest + binary files. */
export function parseWorkspaceZipBundle(zipBytes: Uint8Array): {
  manifest: WorkspaceZipManifest;
  archive: WorkspaceArchive;
  files: Map<string, Buffer>;
} {
  const entries = extractZipArchive(zipBytes);
  const manifestRaw = entries.get("manifest.json");
  if (!manifestRaw) {
    throw new Error("Invalid workspace zip: missing manifest.json");
  }
  const manifest = JSON.parse(
    manifestRaw.toString("utf8"),
  ) as WorkspaceZipManifest;
  if (manifest.format !== "kaneo-workspace-zip" || manifest.version !== 1) {
    throw new Error("Unsupported workspace zip manifest format");
  }

  const tables: WorkspaceArchive["tables"] = Object.create(null);
  for (const tableName of Object.keys(manifest.tableCounts ?? {})) {
    if (UNSAFE_KEYS.has(tableName) || !/^[a-z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name in manifest: ${tableName}`);
    }
    tables[tableName] = [];
  }
  const files = new Map<string, Buffer>();

  for (const [name, buf] of entries.entries()) {
    if (name.endsWith("/")) continue;
    if (name.startsWith("data/") && name.endsWith(".ndjson")) {
      const tableName = name.slice("data/".length, -".ndjson".length);
      if (UNSAFE_KEYS.has(tableName) || !/^[a-z0-9_]+$/.test(tableName)) {
        throw new Error(`Invalid table name in archive: ${tableName}`);
      }
      const lines = buf
        .toString("utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      tables[tableName] = lines.map((line) => JSON.parse(line));
    } else if (name.startsWith("files/")) {
      const rel = name.slice("files/".length);
      if (rel) files.set(rel, buf);
    }
  }

  const archive = archiveSchema.parse({
    format: "quills-workspace",
    version: 1,
    origin: manifest.origin ?? "kaneo",
    createdAt: manifest.exportedAt,
    sourceWorkspaceId: manifest.workspaceId,
    tables: { ...tables },
    storageKeys: manifest.storageKeys ?? [],
    omittedTables: manifest.omittedTables ?? [...OMITTED_TABLES],
  });

  return { manifest, archive, files };
}

/** Round-trip restores a workspace .zip bundle into an empty target workspace (#327). */
export async function importWorkspaceZipBundle(
  db: Database,
  actor: QuillsActor,
  zipBytes: Uint8Array,
  options: {
    workspaceId: string;
    members: CanonicalMember[];
    workspace: { name: string; slug: string };
    mapping?: Record<string, Record<string, string>>;
    dryRun?: boolean;
  },
) {
  const { manifest, archive, files } = parseWorkspaceZipBundle(zipBytes);
  const prepared = prepareArchive(
    archive,
    options.mapping ?? {},
    options.workspaceId,
    options.members,
  );
  const result = await importWorkspaceArchive(
    db,
    actor,
    prepared,
    options.members,
    options.workspace,
    options.dryRun ?? false,
  );
  return { manifest, result, restoredFileCount: files.size };
}
