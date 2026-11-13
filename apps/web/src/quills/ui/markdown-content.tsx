import { Markdown } from "./upstream";

export interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm max-w-none break-words dark:prose-invert">
      <Markdown skipHtml components={{ h1: "h2" }}>
        {content}
      </Markdown>
    </div>
  );
}
