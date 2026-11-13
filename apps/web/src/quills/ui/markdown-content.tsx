import { Markdown } from "./upstream";

export interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="portal-prose prose prose-sm max-w-none break-words dark:prose-invert text-base leading-loose [&>*+*]:mt-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-semibold">
      <Markdown skipHtml components={{ h1: "h2" }}>
        {content}
      </Markdown>
    </div>
  );
}
