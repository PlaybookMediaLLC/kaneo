import { useMemo } from "react";
import { Markdown, cn } from "./upstream";

export interface MarkdownContentProps {
  content: string;
  /** Overrides, such as a smaller size for comments. */
  className?: string;
  /** Text that a customer wrote. It shows no images, so no remote image can track readers. */
  customer?: boolean;
}

export function MarkdownContent({
  content,
  className,
  customer,
}: MarkdownContentProps) {
  // Long threads re-render often. The same element lets React skip parsing unchanged text.
  const markdown = useMemo(
    () => (
      <Markdown
        skipHtml
        components={{ h1: "h2" }}
        disallowedElements={customer ? ["img"] : undefined}
      >
        {content}
      </Markdown>
    ),
    [content, customer],
  );
  return (
    <div
      className={cn(
        "portal-prose prose prose-sm max-w-none break-words dark:prose-invert text-[15px] leading-relaxed [&>*+*]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-semibold",
        className,
      )}
    >
      {markdown}
    </div>
  );
}
