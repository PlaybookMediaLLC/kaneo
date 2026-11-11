import type { ArticleBlock } from "../ui/types.js";

/**
 * Inline Markdown to plain text: links and images keep their text, emphasis marks go.
 * Underscores mark emphasis only at word edges, so names like KANEO_API_URL stay whole.
 */
const inline = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|\*|~~|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|\W)(__|_)(\S(?:.*?\S)?)\2(?!\w)/g, "$1$3")
    .trim();

/**
 * Article Markdown to the view's text blocks. The view renders blocks as escaped text, so raw
 * HTML stays visible text and is never interpreted. ponytail: line-based subset (headings,
 * fenced code, lists, paragraphs); tables and nested lists flatten to paragraphs and items.
 */
export function markdownBlocks(markdown: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    const text = inline(paragraph.join(" "));
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith(fence[1]!))
        code.push(lines[i]!);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const text = inline(heading[1]!);
      if (text) blocks.push({ type: "heading", text });
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !item[1];
      const last = blocks[blocks.length - 1];
      const text = inline(item[3]!);
      if (last?.type === "list" && !!last.ordered === ordered)
        blocks[blocks.length - 1] = { ...last, items: [...last.items, text] };
      else blocks.push({ type: "list", items: [text], ordered });
      continue;
    }
    if (!line.trim()) flush();
    else paragraph.push(line.replace(/^\s*>\s?/, ""));
  }
  flush();
  return blocks;
}

/** The plain text of blocks, for search and previews. */
export const blocksText = (blocks: readonly ArticleBlock[]) =>
  blocks
    .map((block) => ("text" in block ? block.text : block.items.join("\n")))
    .join("\n\n");
