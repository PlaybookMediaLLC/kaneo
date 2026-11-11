import { describe, it, expect } from "vite-plus/test";
import { prepareArchive } from "./import-archive";
import { collectStorageKeys, type WorkspaceArchive } from "./archive";
const base = (): WorkspaceArchive => ({
  format: "quills-workspace",
  version: 1,
  origin: "quackback",
  createdAt: new Date().toISOString(),
  tables: {},
  storageKeys: [],
  omittedTables: [],
});
describe("Workspace archive validation", () => {
  it("requires explicit canonical staff and native resource mappings", () => {
    const archive = base();
    archive.tables.principal = [
      { id: "old-staff", role: "admin", type: "user", display_name: "Old" },
    ];
    expect(() => prepareArchive(archive, {}, "target", [])).toThrow(
      "Explicit mapping",
    );
    const result = prepareArchive(
      archive,
      { actors: { "old-staff": "current" } },
      "target",
      [{ id: "current", name: "Current", image: null }],
    );
    expect(result.tables.principal![0]).toMatchObject({
      workspace_id: "target",
      kaneo_user_id: "current",
      display_name: "Current",
      role: "user",
      user_id: null,
    });
    archive.tables.board_projects = [
      { board_id: "board", project_id: "foreign" },
    ];
    expect(() =>
      prepareArchive(
        archive,
        { actors: { "old-staff": "current" } },
        "target",
        [{ id: "current", name: "Current", image: null }],
      ),
    ).toThrow("Explicit project mapping");
  });
  it("remaps only storage fields, derives keys from data, and ignores forged manifest keys", () => {
    const archive = base();
    archive.tables.files = [
      {
        id: "same",
        name: "old/key",
        storage_key: "old/key",
        meta: { thumbKey: "old/thumb", label: "old/key" },
      },
    ];
    archive.tables.conversation_messages = [
      { attachments: [{ preview: { renditionKey: "old/video" } }] },
    ];
    archive.storageKeys = ["forged/key"];
    const result = prepareArchive(
      archive,
      {
        storage: {
          "old/key": "new/key",
          "old/thumb": "new/thumb",
          "old/video": "new/video",
          same: "bad-id",
        },
      },
      "target",
      [],
    );
    expect(result.tables.files![0]).toMatchObject({
      id: "same",
      name: "old/key",
      storage_key: "new/key",
      meta: { thumbKey: "new/thumb", label: "old/key" },
    });
    expect(collectStorageKeys(result.tables).sort()).toEqual([
      "new/key",
      "new/thumb",
      "new/video",
    ]);
  });
  it("renames live tags that differ only in case, as migration 0020 does", () => {
    const archive = base();
    const id = (n: number) =>
      `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    archive.tables.conversation_tags = [
      { id: id(3), name: "BUG", created_at: "2026-01-03T00:00:00.000Z" },
      { id: id(2), name: "bug", created_at: "2026-01-01T00:00:00.000Z" },
      { id: id(1), name: "Bug", created_at: "2026-01-01T00:00:00.000Z" },
      {
        id: id(4),
        name: "bug",
        created_at: "2025-01-01T00:00:00.000Z",
        deleted_at: "2026-01-04T00:00:00.000Z",
      },
      {
        id: id(5),
        name: "x".repeat(50),
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: id(6),
        name: "X".repeat(50),
        created_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    const result = prepareArchive(archive, {}, "target", []);
    expect(result.tables.conversation_tags!.map((tag) => tag.name)).toEqual([
      "BUG (000000000003)",
      "bug (000000000002)",
      // The oldest (the lowest ID on a tie) keeps its name; an archived tag keeps its name.
      "Bug",
      "bug",
      "x".repeat(50),
      `${"X".repeat(35)} (000000000006)`,
    ]);
  });
  it("pauses an imported integration so it delivers nothing until an admin enables it", () => {
    const archive = base();
    archive.tables.integrations = [
      { id: "integration", integration_type: "n8n", status: "active" },
    ];
    const result = prepareArchive(archive, {}, "target", []);
    expect(result.tables.integrations![0]).toMatchObject({ status: "paused" });
  });

  it("imports portal invites without a usable token and keeps the hero image key", () => {
    const archive = base();
    archive.tables.portal_invites = [
      { id: "pending", status: "pending", token_hashes: ["hash"] },
      { id: "accepted", status: "accepted", token_hashes: [] },
    ];
    archive.tables.settings = [{ widget_hero_key: "old/hero" }];
    const result = prepareArchive(
      archive,
      { storage: { "old/hero": "new/hero" } },
      "target",
      [],
    );
    expect(result.tables.portal_invites).toMatchObject([
      { id: "pending", status: "expired", token_hashes: [] },
      { id: "accepted", status: "accepted", token_hashes: [] },
    ]);
    expect(result.tables.settings![0]).toMatchObject({
      widget_hero_key: "new/hero",
    });
    expect(result.storageKeys).toEqual(["new/hero"]);
  });
  it("rejects public numbers that cannot be allocated safely", () => {
    for (const number of [0, -1, "9007199254740991", "9223372036854775807"]) {
      const archive = base();
      archive.tables.tickets = [{ number }];
      expect(() => prepareArchive(archive, {}, "target", [])).toThrow(
        "Unsupported public number",
      );
    }
    const archive = base();
    archive.tables.kb_articles = [{ url_id: 2147483647 }];
    expect(() => prepareArchive(archive, {}, "target", [])).toThrow(
      "Unsupported public number",
    );
  });
  it("rejects unknown tables, columns, versions and malformed mappings", () => {
    const archive = base();
    archive.tables.session = [];
    expect(() => prepareArchive(archive, {}, "target", [])).toThrow(
      "Unsupported archive table",
    );
    archive.tables = { boards: [{ invented_column: true }] };
    expect(() => prepareArchive(archive, {}, "target", [])).toThrow(
      "Unknown archive column",
    );
    expect(() =>
      prepareArchive({ ...base(), version: 2 }, {}, "target", []),
    ).toThrow();
    expect(() =>
      prepareArchive(base(), { actors: { x: "" } }, "target", []),
    ).toThrow();
  });
});
