import { describe, expect, it } from "vite-plus/test";
import type { ToolContext } from "../ai/tool";
import { nativeTools, offeredTools, TOOL_NAMES, writeTools } from "./index";

const context = (change: Partial<ToolContext> = {}): ToolContext => ({
  workspaceId: "workspace_test",
  principalId: "principal_test",
  actions: ["read", "create", "update"],
  conversationId: "conversation_test",
  ticketId: null,
  knowledge: { helpCenter: true, documents: true },
  ...change,
});
const names = (change: Partial<ToolContext> = {}, off: string[] = []) =>
  offeredTools(context(change), new Set(off)).map((tool) => tool.name);

describe("tool registry", () => {
  it("offers every tool to a member in a conversation, in catalogue order", () => {
    expect(names()).toEqual([...TOOL_NAMES]);
  });

  it("offers a tool only when the teammate holds its action, it fits the turn and it is on", () => {
    const reads = [
      "search_help_center",
      "search_knowledge",
      "search_conversations",
    ];
    expect(names({ actions: ["read"] })).toEqual(reads);
    expect(names({ conversationId: null, ticketId: "ticket_test" })).toEqual(
      reads,
    );
    expect(
      names({ knowledge: { helpCenter: false, documents: true } }),
    ).not.toContain("search_help_center");
    expect(names({}, ["set_conversation_status"])).not.toContain(
      "set_conversation_status",
    );
  });

  it("registers each tool once under its own name, and all write tools default to required approval with previewDiff (#300)", () => {
    expect(Object.keys(nativeTools).sort()).toEqual([...TOOL_NAMES].sort());
    for (const [name, tool] of Object.entries(nativeTools))
      expect(tool.name).toBe(name);
    for (const tool of Object.values(writeTools)) {
      expect(tool.approval).toBe("required");
      expect(tool.action).toBe("update");
      expect(typeof tool.previewDiff).toBe("function");
    }
    expect(names({ actions: ["read", "create"] })).not.toContain(
      "add_private_note",
    );
  });
});
