// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../openapi";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  findConversation,
  priorities,
  statuses,
} from "../support/conversation-model";
import {
  attachTag,
  requireClosable,
  resolveLiveTag,
  setPriority,
  setStatus,
} from "../support/conversation-ops";

// The assistant's tools. A read tool runs in the worker with the asking teammate's visibility.
// A write tool never runs in the worker: it becomes a pending action, and it runs only when a
// teammate approves it, in that teammate's request, through the support domain functions that
// the teammate's own route calls. Every write tool needs `update`, the approval route's action.

export const TOOL_NAMES = [
  "search_help_center",
  "search_knowledge",
  "set_conversation_status",
  "set_conversation_priority",
  "add_conversation_tag",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
type Conversation = Awaited<ReturnType<typeof findConversation>>;
export type ToolChange = {
  type:
    | "conversation.status_changed"
    | "conversation.priority_changed"
    | "conversation.tags_changed";
  entityType: "conversation";
  entityId: string;
  payload: Record<string, string>;
};

const query = z.object({ query: z.string().trim().min(1).max(200) });
export const readTools = {
  search_help_center: {
    description:
      "Search the published help-center articles. Returns titles and short excerpts.",
    args: query,
  },
  search_knowledge: {
    description:
      "Search the team's answer snippets, knowledge documents and web pages.",
    args: query,
  },
} as const;

type WriteTool<A extends z.ZodObject> = {
  description: string;
  args: A;
  /** The approval route's action. A tool that needs another permission cannot be approved. */
  action: "update";
  summary: (args: z.output<A>) => string;
  execute: (
    db: Database,
    actor: QuillsActor,
    conversation: Conversation,
    args: z.output<A>,
  ) => Promise<ToolChange | null>;
};
const writeTool = <A extends z.ZodObject>(tool: WriteTool<A>) => tool;
const change = (
  conversation: Conversation,
  type: ToolChange["type"],
  payload: Record<string, string> = {},
): ToolChange => ({
  type,
  entityType: "conversation",
  entityId: conversation.id,
  payload,
});

export const writeTools = {
  set_conversation_status: writeTool({
    description:
      "Propose a new status for the current conversation. A teammate must approve it.",
    args: z.object({ status: z.enum(statuses) }),
    action: "update",
    summary: (args) => `Set the conversation status to ${args.status}`,
    // As setQuillsConversationStatus: a close needs every required attribute.
    execute: async (db, _actor, conversation, args) => {
      if (args.status === "closed" && conversation.status !== "closed")
        await requireClosable(db, conversation);
      return (await setStatus(db, conversation, args.status))
        ? change(conversation, "conversation.status_changed", {
            status: args.status,
          })
        : null;
    },
  }),
  set_conversation_priority: writeTool({
    description:
      "Propose a new priority for the current conversation. A teammate must approve it.",
    args: z.object({ priority: z.enum(priorities) }),
    action: "update",
    summary: (args) => `Set the conversation priority to ${args.priority}`,
    execute: async (db, actor, conversation, args) =>
      (await setPriority(db, actor, conversation, args.priority))
        ? change(conversation, "conversation.priority_changed", {
            priority: args.priority,
          })
        : null,
  }),
  add_conversation_tag: writeTool({
    description:
      "Propose a tag (by its ID) for the current conversation. A teammate must approve it.",
    args: z.object({ tagId: flexibleToTypeIdSchema("conversation_tag") }),
    action: "update",
    summary: (args) => `Tag the conversation with ${args.tagId}`,
    execute: async (db, _actor, conversation, args) => {
      const tagId = await resolveLiveTag(
        db,
        args.tagId as TypeId<"conversation_tag">,
      );
      return (await attachTag(db, conversation, tagId))
        ? change(conversation, "conversation.tags_changed")
        : null;
    },
  }),
};
export type WriteToolName = keyof typeof writeTools;
export const isWriteTool = (name: string): name is WriteToolName =>
  Object.hasOwn(writeTools, name);

/** The tool catalogue as the settings page lists it. */
export const toolCatalogue = TOOL_NAMES.map((name) =>
  isWriteTool(name)
    ? {
        name,
        kind: "write" as const,
        description: writeTools[name].description,
        requires: writeTools[name].action,
      }
    : {
        name,
        kind: "read" as const,
        description: readTools[name as keyof typeof readTools].description,
        requires: "read" as const,
      },
);
