import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readDraft, saveDraft, startingDraft } from "./composer-draft";

describe("composer draft", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it("saves, reads and clears a draft", () => {
    saveDraft("draft", { title: "Dark mode", content: "At night" });
    expect(readDraft("draft")).toEqual({
      title: "Dark mode",
      content: "At night",
    });
    saveDraft("draft", { title: " ", content: "" });
    expect(localStorage.getItem("draft")).toBeNull();
  });
  it("starts a given title as a new post and keeps the older draft saved", () => {
    saveDraft("draft", { title: "Old", content: "Details" });
    expect(startingDraft("draft", "Search text")).toEqual({
      title: "Search text",
      content: "",
    });
    expect(readDraft("draft")).toEqual({ title: "Old", content: "Details" });
    expect(startingDraft("draft")).toEqual({
      title: "Old",
      content: "Details",
    });
  });
  it("reads broken or blocked storage as no draft", () => {
    localStorage.setItem("draft", "{not json");
    expect(readDraft("draft")).toEqual({ title: "", content: "" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(() =>
      saveDraft("draft", { title: "Kept in memory", content: "" }),
    ).not.toThrow();
    expect(readDraft(undefined)).toEqual({ title: "", content: "" });
  });
});
