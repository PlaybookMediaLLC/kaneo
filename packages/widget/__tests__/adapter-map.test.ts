import { describe, expect, it } from "vite-plus/test";
import { blocksText, markdownBlocks } from "../src/adapter/markdown";
import {
  mergeMessages,
  toArticle,
  toComment,
  toConversation,
  toMessage,
  toPost,
  toUpdate,
  type ApiMessage,
  type ApiPost,
} from "../src/adapter/map";

const post: ApiPost = {
  id: "post_1",
  title: "Dark mode",
  content: "Please add it",
  board: { id: "board_1", name: "Ideas", slug: "ideas" },
  status: { id: "status_1" },
  stage: "planned",
  author: { name: null, avatarUrl: null },
  voteCount: 3,
  voted: true,
  following: false,
  createdAt: "2026-11-01T10:00:00.000Z",
};
const message = (id: string, at: string, fromVisitor = false): ApiMessage => ({
  id,
  fromVisitor,
  author: fromVisitor ? null : { name: "Ana", avatarUrl: null },
  content: `text ${id}`,
  createdAt: at,
});

describe("markdownBlocks", () => {
  it("maps headings, lists, code and paragraphs, and keeps raw HTML as text", () => {
    const blocks = markdownBlocks(
      [
        "# Getting **started**",
        "",
        "Open [settings](https://x.test) and",
        "choose *Billing*. <script>alert(1)</script>",
        "",
        "- one",
        "- `two`",
        "1. first",
        "",
        "```",
        "<b>kept as text</b>",
        "```",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "heading", text: "Getting started" },
      {
        type: "paragraph",
        text: "Open settings and choose Billing. <script>alert(1)</script>",
      },
      { type: "list", items: ["one", "two"], ordered: false },
      { type: "list", items: ["first"], ordered: true },
      { type: "code", text: "<b>kept as text</b>" },
    ]);
    expect(blocksText(blocks)).toContain("one\ntwo");
  });

  it("keeps names, comparisons and code text whole", () => {
    expect(
      markdownBlocks(
        "Set KANEO_API_URL and __init__ now. a < b and c > d. Use `Array<string>`. _Note_",
      ),
    ).toEqual([
      {
        type: "paragraph",
        text: "Set KANEO_API_URL and init now. a < b and c > d. Use Array<string>. Note",
      },
    ]);
  });

  it("keeps plain text as paragraphs", () => {
    expect(markdownBlocks("Line one\n\nLine two")).toEqual([
      { type: "paragraph", text: "Line one" },
      { type: "paragraph", text: "Line two" },
    ]);
  });
});

describe("API to view mapping", () => {
  it("maps a post and leaves out a closed one", () => {
    expect(toPost(post)).toEqual({
      id: "post_1",
      title: "Dark mode",
      body: "Please add it",
      author: "Anonymous",
      avatarUrl: undefined,
      votes: 3,
      voted: true,
      following: false,
      status: "planned",
      createdAt: "2026-11-01T10:00:00.000Z",
    });
    expect(toPost({ ...post, stage: null })).toBeNull();
  });

  it("maps a comment's 👍 reaction to its vote and a deleted comment to a notice", () => {
    const comment = {
      id: "c1",
      parentId: null,
      content: "Agree",
      author: { name: "Lee", avatarUrl: "https://a.test/l.png" },
      deleted: false,
      createdAt: "2026-11-01T10:00:00.000Z",
      reactions: [
        { emoji: "🎉", count: 5, reacted: false },
        { emoji: "👍", count: 2, reacted: true },
      ],
    };
    expect(toComment(comment)).toMatchObject({
      body: "Agree",
      author: "Lee",
      parentId: undefined,
      votes: 2,
      voted: true,
    });
    expect(
      toComment({
        ...comment,
        deleted: true,
        content: "",
        author: null,
        reactions: [],
      }),
    ).toMatchObject({
      body: "This comment was deleted.",
      votes: 0,
      voted: false,
    });
  });

  it("maps a changelog entry with blocks and linked requests", () => {
    expect(
      toUpdate({
        id: "e1",
        title: "Exports",
        content: "## New\n\nCSV export.",
        publishedAt: "2026-11-02T12:00:00.000Z",
        author: null,
        linkedPosts: [{ id: "post_1" }],
        requesterCount: 4,
      }),
    ).toMatchObject({
      body: "New\n\nCSV export.",
      blocks: [
        { type: "heading", text: "New" },
        { type: "paragraph", text: "CSV export." },
      ],
      date: "November 2, 2026",
      relatedPostIds: ["post_1"],
      requesterCount: 4,
    });
  });

  it("uses an article's description until its Markdown body is read", () => {
    const summary = {
      id: "article_1",
      title: "Billing",
      description: "How invoices work",
      updatedAt: "2026-11-01T00:00:00.000Z",
      author: { name: "Sam" },
      category: { name: "Account" },
    };
    expect(toArticle(summary)).toEqual({
      id: "article_1",
      category: "Account",
      title: "Billing",
      body: "How invoices work",
      author: { name: "Sam" },
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(
      toArticle({ ...summary, content: "Pay **monthly**.", helpful: false }),
    ).toMatchObject({
      body: "Pay monthly.",
      blocks: [{ type: "paragraph", text: "Pay monthly." }],
      helpful: false,
    });
    expect(toArticle({ ...summary, helpful: null })).not.toHaveProperty(
      "helpful",
    );
  });

  it("maps conversations and messages", () => {
    expect(toMessage(message("m1", "2026-11-01T10:00:00.000Z", true))).toEqual({
      id: "m1",
      body: "text m1",
      author: "You",
      sentAt: "2026-11-01T10:00:00.000Z",
      fromVisitor: true,
    });
    expect(
      toConversation(
        { id: "conv_1", subject: null, preview: "Hello", unreadCount: 2 },
        [message("m2", "2026-11-01T10:00:00.000Z")],
      ),
    ).toMatchObject({
      title: "Hello",
      unreadCount: 2,
      messages: [{ id: "m2", author: "Ana", fromVisitor: false }],
    });
  });

  it("merges an overlapping ?after= page by message ID, in time order", () => {
    const current = [
      toMessage(message("m1", "2026-11-01T10:00:00.000Z")),
      toMessage(message("m2", "2026-11-01T10:01:00.000Z")),
    ];
    const merged = mergeMessages(
      current,
      [
        message("m2", "2026-11-01T10:01:00.000Z"),
        message("m4", "2026-11-01T10:03:00.000Z"),
        message("m3", "2026-11-01T10:02:00.000Z"),
      ].map(toMessage),
    );
    expect(merged.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });
});
