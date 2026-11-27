import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  clearThreadDraft,
  readThreadDraft,
  writeThreadDraft,
} from "./thread-draft";

describe("thread-draft", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("persists text and mode per thread and preserves draft across mode switch", () => {
    writeThreadDraft("ws_1", "conversation", "conv_1", {
      text: "Hey @alice look at this",
      mode: "reply",
    });
    expect(readThreadDraft("ws_1", "conversation", "conv_1")).toEqual({
      text: "Hey @alice look at this",
      mode: "reply",
    });

    // Mode switch updates mode while preserving draft text.
    writeThreadDraft("ws_1", "conversation", "conv_1", {
      text: "Hey @alice look at this",
      mode: "note",
    });
    expect(readThreadDraft("ws_1", "conversation", "conv_1")).toEqual({
      text: "Hey @alice look at this",
      mode: "note",
    });

    // Other threads remain isolated.
    expect(readThreadDraft("ws_1", "conversation", "conv_2")).toBeNull();
    clearThreadDraft("ws_1", "conversation", "conv_1");
    expect(readThreadDraft("ws_1", "conversation", "conv_1")).toBeNull();
  });

  it("isolates drafts across different signed-in users on the same browser", () => {
    writeThreadDraft(
      "ws_1",
      "conversation",
      "conv_1",
      { text: "User A draft", mode: "note" },
      "user_a",
    );
    expect(
      readThreadDraft("ws_1", "conversation", "conv_1", "user_b"),
    ).toBeNull();
    expect(readThreadDraft("ws_1", "conversation", "conv_1", "user_a")).toEqual(
      { text: "User A draft", mode: "note" },
    );
  });
});
